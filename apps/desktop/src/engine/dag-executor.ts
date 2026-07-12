import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineNode } from '@sigil/schema/nodes';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { ExecutableWorkflow } from '@sigil/schema/topology';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Either, Option } from 'effect';

import type { CapabilityBroker } from './capability-broker.js';
import { evaluateCondition, matchSwitchCase } from './condition-evaluator.js';
import type { EventBus, WorkflowRunPayload } from './event-bus.js';
import type { NodeHandlerDeps, NodeRunResult, Sleep } from './node-handlers/types.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import { resolveTemplate } from './template.js';
import { acceptWorkflow } from './workflow-acceptance.js';
import type { WorkflowRunOutcome } from './workflow-run-supervisor.js';
import { createInMemoryWorkflowStateStore, type WorkflowStateStore } from './workflow-state.js';
import { createWorkflowTopologyError } from './workflow-topology-error.js';

export interface ExecutorSettings {
    readonly notifyOnWorkflowError: boolean;
    readonly collisionSuffixStyle: CollisionSuffixStyle;
}

export interface ExecutionOptions {
    readonly runId?: string;
    readonly workflowId?: string;
    readonly signal?: AbortSignal;
}

export interface WorkflowExecutionResult {
    readonly pipelineId: string;
    readonly workflowId: string;
    readonly runId?: string;
    readonly outcome: WorkflowRunOutcome;
    readonly message?: string;
}

export const DEFAULT_EXECUTOR_SETTINGS: ExecutorSettings = {
    notifyOnWorkflowError: true,
    collisionSuffixStyle: 'windows',
};

const DEFAULT_SLEEP: Sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(new Error('Workflow run cancelled.'));

    return new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = (): void => {
            cleanup();
            reject(new Error('Workflow run cancelled.'));
        };

        timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
};

const SEED_CONTEXT: WorkflowContext = { event: '', payload: {}, vars: {} };

function reportNodeError(
    bus: EventBus,
    settings: ExecutorSettings,
    pipeline: CompiledPipeline,
    runPayload: WorkflowRunPayload,
    nodeId: string,
    err: unknown,
): WorkflowExecutionResult {
    const message = err instanceof Error ? err.message : String(err);
    bus.next({
        name: 'workflow.error',
        payload: { ...runPayload, nodeId, message },
    });
    if (settings.notifyOnWorkflowError) {
        bus.next({
            name: 'notification.show',
            payload: { title: 'Workflow error', body: message },
        });
    }
    bus.next({
        name: 'workflow.completed',
        payload: { ...runPayload, outcome: 'failed' },
    });
    return {
        pipelineId: pipeline.id,
        workflowId: runPayload.workflowId ?? pipeline.workflowId,
        ...(runPayload.runId ? { runId: runPayload.runId } : {}),
        outcome: 'failed',
        message,
    };
}

function cancellationMessage(signal: AbortSignal | undefined): string {
    const reason: unknown = signal?.reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
    if (reason instanceof Error) return reason.message;
    return 'Workflow run cancelled.';
}

function executionResult(
    pipeline: CompiledPipeline,
    runPayload: WorkflowRunPayload,
    outcome: WorkflowRunOutcome,
    message?: string,
): WorkflowExecutionResult {
    return {
        pipelineId: pipeline.id,
        workflowId: runPayload.workflowId ?? pipeline.workflowId,
        ...(runPayload.runId ? { runId: runPayload.runId } : {}),
        outcome,
        ...(message ? { message } : {}),
    };
}

function emitCancelled(
    bus: EventBus,
    pipeline: CompiledPipeline,
    runPayload: WorkflowRunPayload,
    signal: AbortSignal | undefined,
): WorkflowExecutionResult {
    const reason = cancellationMessage(signal);
    bus.next({
        name: 'workflow.cancelled',
        payload: {
            pipelineId: pipeline.id,
            ...(runPayload.workflowId ? { workflowId: runPayload.workflowId } : {}),
            ...(runPayload.runId ? { runId: runPayload.runId } : {}),
            phase: 'running',
            reason,
        },
    });
    return executionResult(pipeline, runPayload, 'cancelled', reason);
}

export async function executePipeline(
    pipeline: CompiledPipeline,
    bus: EventBus,
    handlerRegistry: NodeHandlerRegistry,
    settings: ExecutorSettings = DEFAULT_EXECUTOR_SETTINGS,
    sleep: Sleep = DEFAULT_SLEEP,
    stateStore: WorkflowStateStore = createInMemoryWorkflowStateStore(),
    capabilityBroker?: CapabilityBroker,
    seedContext?: WorkflowContext,
    executionOptions: ExecutionOptions = {},
): Promise<WorkflowExecutionResult> {
    const topology = acceptWorkflow(pipeline, handlerRegistry);
    if (!topology.ok) {
        throw createWorkflowTopologyError(topology.diagnostics);
    }

    return executeValidatedWorkflow(
        topology.value,
        bus,
        handlerRegistry,
        settings,
        sleep,
        stateStore,
        capabilityBroker,
        seedContext,
        executionOptions,
    );
}

export async function executeValidatedWorkflow(
    workflow: ExecutableWorkflow,
    bus: EventBus,
    handlerRegistry: NodeHandlerRegistry,
    settings: ExecutorSettings = DEFAULT_EXECUTOR_SETTINGS,
    sleep: Sleep = DEFAULT_SLEEP,
    stateStore: WorkflowStateStore = createInMemoryWorkflowStateStore(),
    capabilityBroker?: CapabilityBroker,
    seedContext?: WorkflowContext,
    executionOptions: ExecutionOptions = {},
): Promise<WorkflowExecutionResult> {
    const pipeline = workflow.pipeline;
    const runPayload: WorkflowRunPayload = {
        pipelineId: pipeline.id,
        workflowId: executionOptions.workflowId ?? pipeline.workflowId,
        ...(executionOptions.runId ? { runId: executionOptions.runId } : {}),
    };

    if (executionOptions.signal?.aborted) {
        return emitCancelled(bus, pipeline, runPayload, executionOptions.signal);
    }

    bus.next({ name: 'workflow.started', payload: runPayload });
    const state = stateStore.forWorkflow(pipeline.workflowId);

    try {
        const nodeById = new Map<string, PipelineNode>(
            pipeline.nodes.map((node) => [node.id, node]),
        );
        const order = workflow.executionOrder;
        const topoIndex = new Map<string, number>(order.map((id, index) => [id, index]));

        const triggerNode = nodeById.get(workflow.triggerId);
        if (!triggerNode) {
            bus.next({
                name: 'workflow.completed',
                payload: { ...runPayload, outcome: 'succeeded' },
            });
            return executionResult(pipeline, runPayload, 'succeeded');
        }

        const baseDeps: NodeHandlerDeps = {
            bus,
            sleep,
            resolveTemplate,
            evaluateCondition,
            matchSwitchCase,
            state,
            capabilityBroker: capabilityBroker ?? createDenyAllCapabilityBroker(),
            collisionSuffixStyle: settings.collisionSuffixStyle,
            signal: executionOptions.signal,
        };

        let triggerResult: NodeRunResult;
        try {
            const triggerHandler = handlerRegistry.get(triggerNode.type);
            if (Option.isNone(triggerHandler)) {
                throw new Error(`No handler registered for node type "${triggerNode.type}"`);
            }
            triggerResult = await triggerHandler.value.execute(
                { node: triggerNode, ctx: seedContext ?? SEED_CONTEXT },
                baseDeps,
            );
        } catch (err) {
            if (executionOptions.signal?.aborted) {
                return emitCancelled(bus, pipeline, runPayload, executionOptions.signal);
            }
            return reportNodeError(bus, settings, pipeline, runPayload, triggerNode.id, err);
        }

        const scheduled = new Set<string>([triggerNode.id]);
        const queue: { nodeId: string; ctx: WorkflowContext }[] = [];

        const scheduleDownstream = (sourceId: string, port: string, ctx: WorkflowContext): void => {
            for (const edge of pipeline.edges) {
                if (edge.source === sourceId && edge.sourcePort === port) {
                    if (scheduled.has(edge.target)) continue;
                    scheduled.add(edge.target);
                    queue.push({ nodeId: edge.target, ctx });
                }
            }
        };

        scheduleDownstream(triggerNode.id, triggerResult.activePort, triggerResult.outputCtx);

        while (queue.length > 0) {
            if (executionOptions.signal?.aborted) {
                return emitCancelled(bus, pipeline, runPayload, executionOptions.signal);
            }

            const nextIdx = queue.reduce(
                (best, _, i) =>
                    (topoIndex.get(queue[i].nodeId) ?? 0) < (topoIndex.get(queue[best].nodeId) ?? 0)
                        ? i
                        : best,
                0,
            );
            const [entry] = queue.splice(nextIdx, 1);
            if (entry === undefined) continue;
            const node = nodeById.get(entry.nodeId);
            if (!node) continue;

            try {
                const handler = handlerRegistry.get(node.type);
                if (Option.isNone(handler)) {
                    throw new Error(`No handler registered for node type "${node.type}"`);
                }
                const { outputCtx, activePort } = await handler.value.execute(
                    { node, ctx: entry.ctx },
                    baseDeps,
                );
                scheduleDownstream(entry.nodeId, activePort, outputCtx);
            } catch (err) {
                if (executionOptions.signal?.aborted) {
                    return emitCancelled(bus, pipeline, runPayload, executionOptions.signal);
                }
                return reportNodeError(bus, settings, pipeline, runPayload, entry.nodeId, err);
            }
        }

        if (executionOptions.signal?.aborted) {
            return emitCancelled(bus, pipeline, runPayload, executionOptions.signal);
        }

        bus.next({
            name: 'workflow.completed',
            payload: { ...runPayload, outcome: 'succeeded' },
        });
        return executionResult(pipeline, runPayload, 'succeeded');
    } finally {
        state.flush();
    }
}

function createDenyAllCapabilityBroker(): CapabilityBroker {
    return {
        request: ({ capability }) => Either.left({ kind: 'denied' as const, capability }),
    };
}
