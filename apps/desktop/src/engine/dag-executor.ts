import type { CompiledPipeline } from '@sigil/schema';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { NodeType, PipelineNode } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { EventBus } from './event-bus.js';
import { resolveTemplate } from './template.js';

export type NodeError =
    | { readonly kind: 'node_type_not_a_trigger'; readonly nodeType: NodeType }
    | { readonly kind: 'trigger_node_in_body'; readonly nodeType: NodeType }
    | { readonly kind: 'node_type_not_supported_in_tracer'; readonly nodeType: NodeType };

export type TriggerResult =
    | { readonly ok: true; readonly output: FileEventPayload }
    | { readonly ok: false; readonly error: NodeError };

export type BodyResult = { readonly ok: true } | { readonly ok: false; readonly error: NodeError };

function assertNever(node: never): never {
    throw new Error(`Unhandled node type: ${JSON.stringify(node)}`);
}

function executionOrder(pipeline: CompiledPipeline): readonly string[] {
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

    const roots = pipeline.nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0);
    const queue = roots.map((node) => node.id);
    const visited = new Set<string>();
    const order: string[] = [];

    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || visited.has(id)) continue;
        visited.add(id);
        order.push(id);
        for (const target of adjacency.get(id) ?? []) {
            if (!visited.has(target)) {
                queue.push(target);
            }
        }
    }
    return order;
}

function runTriggerNode(node: PipelineNode, bus: EventBus): TriggerResult {
    switch (node.type) {
        case 'manual-trigger': {
            const payload = node.config.payload;
            bus.next({ name: 'manual.trigger.fired', payload });
            return { ok: true, output: payload };
        }
        case 'file-watcher':
        case 'if-else':
        case 'switch':
        case 'file-manager':
        case 'notification':
        case 'log':
        case 'delay':
        case 'state-get':
        case 'state-set':
            return { ok: false, error: { kind: 'node_type_not_a_trigger', nodeType: node.type } };
        default:
            return assertNever(node);
    }
}

function runBodyNode(node: PipelineNode, ctx: WorkflowContext, bus: EventBus): BodyResult {
    switch (node.type) {
        case 'log': {
            const message = resolveTemplate(node.config.message, ctx);
            bus.next({ name: 'log.output', payload: { message } });
            return { ok: true };
        }
        case 'manual-trigger':
            return { ok: false, error: { kind: 'trigger_node_in_body', nodeType: node.type } };
        case 'file-watcher':
        case 'if-else':
        case 'switch':
        case 'file-manager':
        case 'notification':
        case 'delay':
        case 'state-get':
        case 'state-set':
            return { ok: false, error: { kind: 'node_type_not_supported_in_tracer', nodeType: node.type } };
        default:
            return assertNever(node);
    }
}

export function executePipeline(pipeline: CompiledPipeline, bus: EventBus): void {
    const runPayload = { pipelineId: pipeline.id };
    bus.next({ name: 'workflow.started', payload: runPayload });

    const order = executionOrder(pipeline);
    const nodeById = new Map<string, PipelineNode>(pipeline.nodes.map((node) => [node.id, node]));

    const triggerId = order[0];
    const triggerNode = triggerId === undefined ? undefined : nodeById.get(triggerId);
    if (!triggerNode) {
        bus.next({ name: 'workflow.completed', payload: runPayload });
        return;
    }

    const triggerResult = runTriggerNode(triggerNode, bus);
    if (!triggerResult.ok) {
        bus.next({ name: 'workflow.completed', payload: runPayload });
        return;
    }

    const ctx: WorkflowContext = { event: triggerResult.output, vars: {} };
    for (const id of order.slice(1)) {
        const node = nodeById.get(id);
        if (node) {
            runBodyNode(node, ctx, bus);
        }
    }

    bus.next({ name: 'workflow.completed', payload: runPayload });
}
