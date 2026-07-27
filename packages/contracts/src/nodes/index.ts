import { z } from 'zod';

import {
    type NodeTypeName,
    NodeTypeNameSchema,
    type PipelineNodeId,
    PipelineNodeIdSchema,
    type PluginId,
    PluginIdSchema,
} from '../ids.js';
import {
    BUILTIN_NODE_DESCRIPTORS,
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
export {
    BUILTIN_NODE_DESCRIPTORS,
    BUILTIN_NODE_TYPE_VALUES,
    getNodeDescriptor,
} from './catalog.js';
export type { DelayConfig } from './delay.js';
export { DelayConfigSchema, DelayDescriptor, MAX_DELAY_MS } from './delay.js';
export type { FileManagerConfig } from './file-manager.js';
export { FileManagerConfigSchema, FileManagerDescriptor } from './file-manager.js';
export type { FileWatcherConfig } from './file-watcher.js';
export { FileWatcherConfigSchema, FileWatcherDescriptor } from './file-watcher.js';
export type { IfElseConfig } from './if-else.js';
export { IfElseConfigSchema, IfElseDescriptor } from './if-else.js';
export type { LogConfig } from './log.js';
export { LogConfigSchema, LogDescriptor } from './log.js';
export type { ManualTriggerConfig } from './manual-trigger.js';
export { ManualTriggerConfigSchema, ManualTriggerDescriptor } from './manual-trigger.js';
export type { NotificationConfig } from './notification.js';
export { NotificationConfigSchema, NotificationDescriptor } from './notification.js';
export type { StateGetConfig } from './state-get.js';
export { StateGetConfigSchema, StateGetDescriptor } from './state-get.js';
export type { StateSetConfig, StateSetValueType } from './state-set.js';
export {
    STATE_SET_VALUE_TYPES,
    StateSetConfigSchema,
    StateSetDescriptor,
    StateSetValueTypeSchema,
} from './state-set.js';
export type { SwitchCase, SwitchCaseId, SwitchComparison, SwitchConfig } from './switch.js';
export {
    SWITCH_DEFAULT_PORT,
    SwitchCaseIdSchema,
    SwitchCaseSchema,
    SwitchComparisonSchema,
    SwitchConfigSchema,
    SwitchDescriptor,
} from './switch.js';
export type { NodeDescriptor, UnknownNodeDescriptor } from './types.js';

export const NodeTypeSchema = z.enum(BUILTIN_NODE_TYPE_VALUES);

export type BuiltinPipelineNode = {
    [K in NodeType]: {
        readonly id: PipelineNodeId;
        readonly type: K;
        readonly config: BuiltinNodeConfig<K>;
    };
}[NodeType];

export interface PluginPipelineNode {
    readonly id: PipelineNodeId;
    readonly type: NodeTypeName;
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

function createBuiltinNodeSchema(
    descriptor: Pick<NodeDescriptor<string, z.ZodType>, 'type' | 'configSchema'>,
) {
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
const builtinNodeSchemas = BUILTIN_NODE_DESCRIPTORS.map(({ type, configSchema }) =>
    createBuiltinNodeSchema({ type, configSchema }),
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

/** The structural Node union. Plugin config admission remains domain-owned. */
export const PipelineNodeSchema: z.ZodType<PipelineNode> = z.union([
    PluginPipelineNodeSchema,
    BuiltinPipelineNodeSchema,
]);
