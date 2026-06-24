import type { PipelineCondition } from '@sigil/schema/conditions';
import type { SwitchConfig, PipelineNode, NodeType } from '@sigil/schema/nodes';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { CapabilityBroker } from '../capability-broker.js';
import type { EventBus } from '../event-bus.js';
import type { WorkflowState } from '../workflow-state.js';

export interface NodeRunResult {
    readonly outputCtx: WorkflowContext;
    readonly activePort: string;
}

export type Sleep = (ms: number) => Promise<void>;
export type ResolveTemplate = (template: string, ctx: WorkflowContext) => string;
export type EvaluateCondition = (condition: PipelineCondition, ctx: WorkflowContext) => boolean;
export type MatchSwitchCase = (config: SwitchConfig, ctx: WorkflowContext) => string;

export interface NodeHandlerDeps {
    readonly bus: EventBus;
    readonly sleep: Sleep;
    readonly resolveTemplate: ResolveTemplate;
    readonly evaluateCondition: EvaluateCondition;
    readonly matchSwitchCase: MatchSwitchCase;
    readonly state: WorkflowState;
    readonly capabilityBroker: CapabilityBroker;
    readonly pluginId: string;
    readonly collisionSuffixStyle: CollisionSuffixStyle;
}

export interface NodeHandlerInput {
    readonly node: PipelineNode;
    readonly ctx: WorkflowContext;
}

export interface NodeHandler {
    readonly execute: (input: NodeHandlerInput, deps: NodeHandlerDeps) => Promise<NodeRunResult>;
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
