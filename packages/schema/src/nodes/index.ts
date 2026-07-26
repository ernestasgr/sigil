import { z } from 'zod';

import {
    NodeTypeNameSchema,
    type PipelineNodeId,
    PipelineNodeIdSchema,
    type PluginId,
    PluginIdSchema,
} from '../ids.js';
import {
    BUILTIN_NODE_DEFINITIONS,
    BUILTIN_NODE_TYPE_VALUES,
    type BuiltinNodeConfig,
    type NodeType,
} from './catalog.js';
import type { NodeDescriptor } from './types.js';

export type {
    NodeOutputPortId,
    NodeTypeName,
    PipelineEdgeId,
    PipelineNodeId,
    PluginId,
} from '../ids.js';
export {
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineNodeIdSchema,
    PluginIdSchema,
} from '../ids.js';
export type { BuiltinNodeConfig, NodeType } from './catalog.js';
export type { DelayConfig } from './delay.js';
export { MAX_DELAY_MS } from './delay.js';
export type { FileManagerConfig } from './file-manager.js';
export type { FileWatcherConfig } from './file-watcher.js';
export type { IfElseConfig } from './if-else.js';
export type { LogConfig } from './log.js';
export type { ManualTriggerConfig } from './manual-trigger.js';
export type { NotificationConfig } from './notification.js';
export type { StateGetConfig } from './state-get.js';
export type { StateSetConfig, StateSetValueType } from './state-set.js';
export { STATE_SET_VALUE_TYPES, StateSetValueTypeSchema } from './state-set.js';
export type {
    SwitchCanonicalization,
    SwitchCase,
    SwitchCaseId,
    SwitchComparison,
    SwitchConfig,
    SwitchDiagnostic,
    SwitchDiagnosticCode,
} from './switch.js';
export {
    canonicalizeSwitchValue,
    SWITCH_DEFAULT_PORT,
    SWITCH_DIAGNOSTIC_CODES,
    SwitchCaseIdSchema,
    SwitchCaseSchema,
    SwitchComparisonSchema,
    validateSwitchConfig,
} from './switch.js';
export type { NodeDescriptor, UnknownNodeDescriptor } from './types.js';

const NODE_TYPE_VALUES = BUILTIN_NODE_TYPE_VALUES;

export const NodeTypeSchema = z.enum(NODE_TYPE_VALUES);

export type BuiltinPipelineNode = {
    [K in NodeType]: {
        readonly id: PipelineNodeId;
        readonly type: K;
        readonly config: BuiltinNodeConfig<K>;
    };
}[NodeType];

export interface PluginPipelineNode {
    readonly id: PipelineNodeId;
    readonly type: string;
    readonly pluginId: PluginId;
    readonly config: unknown;
}

export type PipelineNode = BuiltinPipelineNode | PluginPipelineNode;

export function isPluginNode(node: PipelineNode): node is PluginPipelineNode {
    return 'pluginId' in node;
}

export function isBuiltinNode(node: PipelineNode): node is BuiltinPipelineNode {
    return !('pluginId' in node);
}

function createBuiltinNodeSchema(descriptor: NodeDescriptor<string, z.ZodType>) {
    return z
        .object({
            id: PipelineNodeIdSchema,
            type: z.literal(descriptor.type),
            config: descriptor.configSchema,
        })
        .strict()
        .readonly();
}

type BuiltinNodeSchema = ReturnType<typeof createBuiltinNodeSchema>;
const builtinNodeSchemas = BUILTIN_NODE_DEFINITIONS.map(({ descriptor }) =>
    createBuiltinNodeSchema(descriptor),
) as unknown as [BuiltinNodeSchema, ...BuiltinNodeSchema[]];

const BuiltinPipelineNodeSchema = z.discriminatedUnion(
    'type',
    builtinNodeSchemas,
) as z.ZodType<BuiltinPipelineNode>;

const PluginPipelineNodeSchema = z
    .object({
        id: PipelineNodeIdSchema,
        type: NodeTypeNameSchema,
        pluginId: PluginIdSchema,
        config: z.unknown(),
    })
    .strict()
    .readonly() as z.ZodType<PluginPipelineNode>;

// Try plugin nodes first so an object carrying a pluginId remains a plugin
// node even when its type happens to match a builtin node name.
export const PipelineNodeSchema: z.ZodType<PipelineNode> = z.union([
    PluginPipelineNodeSchema,
    BuiltinPipelineNodeSchema,
]);
