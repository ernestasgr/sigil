import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineNode } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import { evaluateCondition, matchSwitchCase } from './condition-evaluator.js';
import type { EventBus, WorkflowRunPayload } from './event-bus.js';
import { resolveTemplate } from './template.js';
import { assertNever } from '../shared/assert-never.js';

export interface ExecutorSettings {
    readonly notifyOnWorkflowError: boolean;
}

export const DEFAULT_EXECUTOR_SETTINGS: ExecutorSettings = { notifyOnWorkflowError: true };

type Sleep = (ms: number) => Promise<void>;

const DEFAULT_SLEEP: Sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

interface NodeRunResult {
    readonly outputCtx: WorkflowContext;
    readonly activePort: string;
}

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

function runTriggerNode(node: PipelineNode, bus: EventBus): WorkflowContext {
    switch (node.type) {
        case 'manual-trigger': {
            const { eventName, payload } = node.config;
            bus.next({ name: 'manual.trigger.fired', payload });
            return { event: eventName, payload, vars: {} };
        }
        case 'file-watcher':
            throw new Error(
                `Trigger node type "${node.type}" is a plugin and is not executed directly by the DAG executor`,
            );
        case 'if-else':
        case 'switch':
        case 'file-manager':
        case 'notification':
        case 'log':
        case 'delay':
        case 'state-get':
        case 'state-set':
            throw new Error(`Node type "${node.type}" is not a trigger`);
        default:
            return assertNever(node);
    }
}

async function runBodyNode(
    node: PipelineNode,
    ctx: WorkflowContext,
    bus: EventBus,
    sleep: Sleep,
): Promise<NodeRunResult> {
    switch (node.type) {
        case 'if-else':
            return {
                outputCtx: ctx,
                activePort: evaluateCondition(node.config.condition, ctx) ? 'true' : 'false',
            };
        case 'switch':
            return { outputCtx: ctx, activePort: matchSwitchCase(node.config, ctx) };
        case 'log': {
            const message = resolveTemplate(node.config.message, ctx);
            bus.next({ name: 'log.output', payload: { message } });
            return { outputCtx: ctx, activePort: 'out' };
        }
        case 'delay': {
            await sleep(node.config.ms);
            return { outputCtx: ctx, activePort: 'out' };
        }
        case 'notification': {
            const title = resolveTemplate(node.config.title, ctx);
            const body = resolveTemplate(node.config.body, ctx);
            bus.next({ name: 'notification.show', payload: { title, body } });
            return { outputCtx: ctx, activePort: 'out' };
        }
        case 'manual-trigger':
        case 'file-watcher':
            throw new Error(`Trigger node "${node.type}" appeared in the pipeline body`);
        case 'file-manager':
        case 'state-get':
        case 'state-set':
            throw new Error(`Node type "${node.type}" is not implemented in this slice`);
        default:
            return assertNever(node);
    }
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
): Promise<void> {
    const runPayload: WorkflowRunPayload = { pipelineId: pipeline.id };
    bus.next({ name: 'workflow.started', payload: runPayload });

    const nodeById = new Map<string, PipelineNode>(pipeline.nodes.map((node) => [node.id, node]));
    const order = topologicalOrder(pipeline);
    const topoIndex = new Map<string, number>(order.map((id, index) => [id, index]));

    const triggerId = order[0];
    const triggerNode = triggerId !== undefined ? nodeById.get(triggerId) : undefined;
    if (!triggerNode) {
        bus.next({ name: 'workflow.completed', payload: runPayload });
        return;
    }

    let initialCtx: WorkflowContext;
    try {
        initialCtx = runTriggerNode(triggerNode, bus);
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

    scheduleDownstream(triggerNode.id, 'out', initialCtx);

    while (queue.length > 0) {
        let nextIdx = 0;
        for (let i = 1; i < queue.length; i++) {
            if (
                (topoIndex.get(queue[i].nodeId) ?? 0) < (topoIndex.get(queue[nextIdx].nodeId) ?? 0)
            ) {
                nextIdx = i;
            }
        }
        const entry = queue.splice(nextIdx, 1)[0];
        if (entry === undefined) continue;
        const node = nodeById.get(entry.nodeId);
        if (!node) continue;

        try {
            const { outputCtx, activePort } = await runBodyNode(node, entry.ctx, bus, sleep);
            scheduleDownstream(entry.nodeId, activePort, outputCtx);
        } catch (err) {
            reportNodeError(bus, settings, runPayload, entry.nodeId, err);
            return;
        }
    }

    bus.next({ name: 'workflow.completed', payload: runPayload });
}
