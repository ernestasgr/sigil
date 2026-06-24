import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineNode } from '@sigil/schema/nodes';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { CapabilityBroker } from './capability-broker.js';
import { evaluateCondition, matchSwitchCase } from './condition-evaluator.js';
import type { EventBus, WorkflowRunPayload } from './event-bus.js';
import { resolveTemplate } from './template.js';
import { nodeHandlers } from './node-handlers/registry.js';
import type { NodeHandlerDeps, NodeRunResult, Sleep } from './node-handlers/types.js';
import { createInMemoryWorkflowStateStore, type WorkflowStateStore } from './workflow-state.js';

export interface ExecutorSettings {
    readonly notifyOnWorkflowError: boolean;
    readonly collisionSuffixStyle: CollisionSuffixStyle;
}

export const DEFAULT_EXECUTOR_SETTINGS: ExecutorSettings = {
    notifyOnWorkflowError: true,
    collisionSuffixStyle: 'windows',
};

const DEFAULT_SLEEP: Sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const SEED_CONTEXT: WorkflowContext = { event: '', payload: {}, vars: {} };

function topologicalOrder(pipeline: CompiledPipeline): readonly string[] {
    const adjacency = new Map<string, string[]>();
    for (const edge of pipeline.edges) {
        const targets = adjacency.get(edge.source) ?? [];
        targets.push(edge.target);
        adjacency.set(edge.source, targets);
    }

    const incomingCount = new Map<string, number>();
    for (const node of pipeline.nodes) {
        incomingCount.set(node.id, 0);
    }
    for (const edge of pipeline.edges) {
        incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, count] of incomingCount) {
        if (count === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) continue;
        order.push(id);
        for (const target of adjacency.get(id) ?? []) {
            const remaining = (incomingCount.get(target) ?? 1) - 1;
            incomingCount.set(target, remaining);
            if (remaining === 0) {
                queue.push(target);
            }
        }
    }
    return order;
}

function reportNodeError(
    bus: EventBus,
    settings: ExecutorSettings,
    runPayload: WorkflowRunPayload,
    nodeId: string,
    err: unknown,
): void {
    const message = err instanceof Error ? err.message : String(err);
    bus.next({
        name: 'workflow.error',
        payload: { pipelineId: runPayload.pipelineId, nodeId, message },
    });
    if (settings.notifyOnWorkflowError) {
        bus.next({
            name: 'notification.show',
            payload: { title: 'Workflow error', body: message },
        });
    }
    bus.next({ name: 'workflow.completed', payload: runPayload });
}

export async function executePipeline(
    pipeline: CompiledPipeline,
    bus: EventBus,
    settings: ExecutorSettings = DEFAULT_EXECUTOR_SETTINGS,
    sleep: Sleep = DEFAULT_SLEEP,
    stateStore: WorkflowStateStore = createInMemoryWorkflowStateStore(),
    capabilityBroker?: CapabilityBroker,
): Promise<void> {
    const runPayload: WorkflowRunPayload = { pipelineId: pipeline.id };
    bus.next({ name: 'workflow.started', payload: runPayload });
    const state = stateStore.forWorkflow(pipeline.workflowId);

    try {
        const nodeById = new Map<string, PipelineNode>(
            pipeline.nodes.map((node) => [node.id, node]),
        );
        const order = topologicalOrder(pipeline);
        const topoIndex = new Map<string, number>(order.map((id, index) => [id, index]));

        const triggerId = order[0];
        const triggerNode = triggerId !== undefined ? nodeById.get(triggerId) : undefined;
        if (!triggerNode) {
            bus.next({ name: 'workflow.completed', payload: runPayload });
            return;
        }

        const deps: NodeHandlerDeps = {
            bus,
            sleep,
            resolveTemplate,
            evaluateCondition,
            matchSwitchCase,
            state,
            capabilityBroker: capabilityBroker ?? createDenyAllCapabilityBroker(),
            pluginId: 'com.sigil.file-manager',
            collisionSuffixStyle: settings.collisionSuffixStyle,
        };

        let triggerResult: NodeRunResult;
        try {
            triggerResult = await nodeHandlers[triggerNode.type].execute(
                { node: triggerNode, ctx: SEED_CONTEXT },
                deps,
            );
        } catch (err) {
            reportNodeError(bus, settings, runPayload, triggerNode.id, err);
            return;
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
            let nextIdx = 0;
            for (let i = 1; i < queue.length; i++) {
                if (
                    (topoIndex.get(queue[i].nodeId) ?? 0) <
                    (topoIndex.get(queue[nextIdx].nodeId) ?? 0)
                ) {
                    nextIdx = i;
                }
            }
            const entry = queue.splice(nextIdx, 1)[0];
            if (entry === undefined) continue;
            const node = nodeById.get(entry.nodeId);
            if (!node) continue;

            try {
                const { outputCtx, activePort } = await nodeHandlers[node.type].execute(
                    { node, ctx: entry.ctx },
                    deps,
                );
                scheduleDownstream(entry.nodeId, activePort, outputCtx);
            } catch (err) {
                reportNodeError(bus, settings, runPayload, entry.nodeId, err);
                return;
            }
        }

        bus.next({ name: 'workflow.completed', payload: runPayload });
    } finally {
        state.flush();
    }
}

function createDenyAllCapabilityBroker(): CapabilityBroker {
    return {
        request: ({ capability }) => ({
            ok: false,
            error: { kind: 'denied', capability },
        }),
    };
}
