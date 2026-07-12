import { randomUUID } from 'node:crypto';
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
import {
    createRunTelemetry,
    type NodeTelemetryIdentity,
    nodeTelemetryIdentity,
    type RunTelemetry,
    safeTelemetryMessage,
} from './telemetry.js';
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
    readonly runId: string;
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

type CorrelatedWorkflowRunPayload = WorkflowRunPayload & {
    readonly workflowId: string;
    readonly runId: string;
};

function reportNodeError(
    telemetry: RunTelemetry,
    settings: ExecutorSettings,
    pipeline: CompiledPipeline,
    runPayload: CorrelatedWorkflowRunPayload,
    node: NodeTelemetryIdentity,
    err: unknown,
): WorkflowExecutionResult {
    const message = safeTelemetryMessage(errorMessage(err));
    telemetry.emit(
        {
            name: 'workflow.error',
            payload: { ...runPayload, ...node, message, outcome: 'failed' },
        },
        { kind: 'outcome', severity: 'error', outcome: 'failed', ...node },
    );
    if (settings.notifyOnWorkflowError) {
        telemetry.emit(
            {
                name: 'notification.show',
                payload: { title: 'Workflow error', body: message },
            },
            { kind: 'node', ...node },
        );
    }
    telemetry.emit(
        {
            name: 'workflow.completed',
            payload: { ...runPayload, outcome: 'failed' },
        },
        { kind: 'outcome', severity: 'error', outcome: 'failed' },
    );
    return {
        pipelineId: pipeline.id,
        workflowId: runPayload.workflowId,
        runId: runPayload.runId,
        outcome: 'failed',
        message,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function cancellationMessage(signal: AbortSignal | undefined): string {
    const reason: unknown = signal?.reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
    if (reason instanceof Error) return reason.message;
    return 'Workflow run cancelled.';
}

function executionResult(
    pipeline: CompiledPipeline,
    runPayload: CorrelatedWorkflowRunPayload,
    outcome: WorkflowRunOutcome,
    message?: string,
): WorkflowExecutionResult {
    return {
        pipelineId: pipeline.id,
        workflowId: runPayload.workflowId,
        runId: runPayload.runId,
        outcome,
        ...(message ? { message } : {}),
    };
}

function emitCancelled(
    telemetry: RunTelemetry,
    pipeline: CompiledPipeline,
    runPayload: CorrelatedWorkflowRunPayload,
    signal: AbortSignal | undefined,
): WorkflowExecutionResult {
    const reason = cancellationMessage(signal);
    telemetry.emit(
        {
            name: 'workflow.cancelled',
            payload: {
                ...runPayload,
                phase: 'running',
                reason,
                outcome: 'cancelled',
            },
        },
        { kind: 'outcome', outcome: 'cancelled' },
    );
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
    const workflowId = executionOptions.workflowId ?? pipeline.workflowId;
    const runId = executionOptions.runId ?? randomUUID();
    const runPayload: CorrelatedWorkflowRunPayload = {
        pipelineId: pipeline.id,
        workflowId,
        runId,
    };
    const telemetry = createRunTelemetry(bus, {
        workflowId,
        pipelineId: pipeline.id,
        runId,
    });

    if (executionOptions.signal?.aborted) {
        return emitCancelled(telemetry, pipeline, runPayload, executionOptions.signal);
    }

    telemetry.emit({ name: 'workflow.started', payload: runPayload });
    const state = stateStore.forWorkflow(workflowId);

    try {
        const nodeById = new Map<string, PipelineNode>(
            pipeline.nodes.map((node) => [node.id, node]),
        );
        const order = workflow.executionOrder;
        const topoIndex = new Map<string, number>(order.map((id, index) => [id, index]));

        const triggerNode = nodeById.get(workflow.triggerId);
        if (!triggerNode) {
            telemetry.emit({
                name: 'workflow.completed',
                payload: { ...runPayload, outcome: 'succeeded' },
            });
            return executionResult(pipeline, runPayload, 'succeeded');
        }

        const commonDeps: Omit<NodeHandlerDeps, 'bus'> = {
            sleep,
            resolveTemplate,
            evaluateCondition,
            matchSwitchCase,
            state,
            capabilityBroker: capabilityBroker ?? createDenyAllCapabilityBroker(),
            collisionSuffixStyle: settings.collisionSuffixStyle,
            signal: executionOptions.signal,
        };

        const executeNode = async (
            node: PipelineNode,
            ctx: WorkflowContext,
        ): Promise<NodeRunResult> => {
            const nodeIdentity = nodeTelemetryIdentity(node);
            const nodeTelemetry = telemetry.forNode(nodeIdentity);
            const span = nodeTelemetry.start();
            try {
                const handler = handlerRegistry.get(node.type);
                if (Option.isNone(handler)) {
                    throw new Error(`No handler registered for node type "${node.type}"`);
                }
                const result = await handler.value.execute(
                    { node, ctx },
                    { ...commonDeps, bus: nodeTelemetry.bus },
                );
                span.finish('succeeded');
                return result;
            } catch (err) {
                span.finish(
                    executionOptions.signal?.aborted ? 'cancelled' : 'failed',
                    errorMessage(err),
                );
                throw err;
            }
        };

        let triggerResult: NodeRunResult;
        try {
            triggerResult = await executeNode(triggerNode, seedContext ?? SEED_CONTEXT);
        } catch (err) {
            if (executionOptions.signal?.aborted) {
                return emitCancelled(telemetry, pipeline, runPayload, executionOptions.signal);
            }
            return reportNodeError(
                telemetry,
                settings,
                pipeline,
                runPayload,
                nodeTelemetryIdentity(triggerNode),
                err,
            );
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
                return emitCancelled(telemetry, pipeline, runPayload, executionOptions.signal);
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
                const { outputCtx, activePort } = await executeNode(node, entry.ctx);
                scheduleDownstream(entry.nodeId, activePort, outputCtx);
            } catch (err) {
                if (executionOptions.signal?.aborted) {
                    return emitCancelled(telemetry, pipeline, runPayload, executionOptions.signal);
                }
                return reportNodeError(
                    telemetry,
                    settings,
                    pipeline,
                    runPayload,
                    nodeTelemetryIdentity(node),
                    err,
                );
            }
        }

        if (executionOptions.signal?.aborted) {
            return emitCancelled(telemetry, pipeline, runPayload, executionOptions.signal);
        }

        telemetry.emit({
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
