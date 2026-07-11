import type { PipelineCondition } from '@sigil/schema/conditions';
import type { NodeType, PipelineNode, UnknownNodeDescriptor } from '@sigil/schema/nodes';
import type { SwitchConfig } from '@sigil/schema/nodes/switch';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import type { CapabilityBroker } from '../capability-broker.js';
import type { BusEvent } from '../event-bus.js';
import type { FileWatcherManager } from '../file-watcher-manager.js';
import type { WorkflowState } from '../workflow-state.js';

export interface NodeRunResult {
    readonly outputCtx: WorkflowContext;
    readonly activePort: string;
}

export interface EventSink {
    readonly next: (event: BusEvent) => void | Promise<void>;
}

export interface PluginEventSink {
    readonly emit: (eventName: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
}

export type Sleep = (ms: number) => Promise<void>;
export type ResolveTemplate = (template: string, ctx: WorkflowContext) => string;
export type EvaluateCondition = (condition: PipelineCondition, ctx: WorkflowContext) => boolean;
export type MatchSwitchCase = (config: SwitchConfig, ctx: WorkflowContext) => string;

export interface NodeHandlerDeps {
    readonly bus: EventSink;
    /** Present for worker-backed Plugins; built-in Nodes use the Event Bus directly. */
    readonly event?: PluginEventSink;
    readonly sleep: Sleep;
    readonly resolveTemplate: ResolveTemplate;
    readonly evaluateCondition: EvaluateCondition;
    readonly matchSwitchCase: MatchSwitchCase;
    readonly state: WorkflowState;
    readonly capabilityBroker: CapabilityBroker;
    readonly collisionSuffixStyle?: CollisionSuffixStyle;
}

export interface NodeHandlerInput {
    readonly node: PipelineNode;
    readonly ctx: WorkflowContext;
}

export interface NodeHandler {
    readonly execute: (input: NodeHandlerInput, deps: NodeHandlerDeps) => Promise<NodeRunResult>;
}

export interface TriggerHandler extends NodeHandler {
    readonly activate: (config: unknown, onEvent: (ctx: WorkflowContext) => void) => () => void;
}

export function isTriggerHandler(handler: NodeHandler): handler is TriggerHandler {
    return 'activate' in handler;
}

export interface KernelDeps {
    readonly fileWatcherManager: Pick<
        FileWatcherManager,
        'registerSubscriber' | 'unregisterSubscriber'
    >;
    readonly capabilityBroker: CapabilityBroker;
}

export interface NodePluginModule {
    readonly descriptor: UnknownNodeDescriptor;
    readonly handler: NodeHandler | ((kernel: KernelDeps) => NodeHandler);
}

export function narrowNode<K extends NodeType>(
    node: PipelineNode,
    type: K,
): Extract<PipelineNode, { type: K }> {
    if (node.type !== type) {
        throw new Error(`Node handler registry mismatch: expected "${type}", got "${node.type}"`);
    }
    return node as Extract<PipelineNode, { type: K }>;
}
