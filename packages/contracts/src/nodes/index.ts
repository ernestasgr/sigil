import { z } from 'zod';

import {
    type NodeTypeName,
    NodeTypeNameSchema,
    type PipelineNodeId,
    PipelineNodeIdSchema,
    type PluginId,
    PluginIdSchema,
} from '../ids.js';
import { type DelayConfig, DelayConfigSchema, MAX_DELAY_MS } from './delay.js';
import { type FileManagerConfig, FileManagerConfigSchema } from './file-manager.js';
import { type FileWatcherConfig, FileWatcherConfigSchema } from './file-watcher.js';
import { type IfElseConfig, IfElseConfigSchema } from './if-else.js';
import { type LogConfig, LogConfigSchema } from './log.js';
import { type ManualTriggerConfig, ManualTriggerConfigSchema } from './manual-trigger.js';
import { type NotificationConfig, NotificationConfigSchema } from './notification.js';
import { type StateGetConfig, StateGetConfigSchema } from './state-get.js';
import {
    STATE_SET_VALUE_TYPES,
    type StateSetConfig,
    StateSetConfigSchema,
    type StateSetValueType,
    StateSetValueTypeSchema,
} from './state-set.js';
import {
    SWITCH_DEFAULT_PORT,
    type SwitchCase,
    type SwitchCaseId,
    SwitchCaseIdSchema,
    SwitchCaseSchema,
    type SwitchComparison,
    SwitchComparisonSchema,
    type SwitchConfig,
    SwitchConfigSchema,
    SwitchOutputPortIdSchema,
} from './switch.js';

export type {
    DelayConfig,
    FileManagerConfig,
    FileWatcherConfig,
    IfElseConfig,
    LogConfig,
    ManualTriggerConfig,
    NotificationConfig,
    StateGetConfig,
    StateSetConfig,
    StateSetValueType,
    SwitchCase,
    SwitchCaseId,
    SwitchComparison,
    SwitchConfig,
};
export {
    DelayConfigSchema,
    FileManagerConfigSchema,
    FileWatcherConfigSchema,
    IfElseConfigSchema,
    LogConfigSchema,
    MAX_DELAY_MS,
    ManualTriggerConfigSchema,
    NotificationConfigSchema,
    STATE_SET_VALUE_TYPES,
    StateGetConfigSchema,
    StateSetConfigSchema,
    StateSetValueTypeSchema,
    SWITCH_DEFAULT_PORT,
    SwitchCaseIdSchema,
    SwitchCaseSchema,
    SwitchComparisonSchema,
    SwitchConfigSchema,
    SwitchOutputPortIdSchema,
};

export const BUILTIN_NODE_TYPES = [
    'file-watcher',
    'manual-trigger',
    'if-else',
    'switch',
    'file-manager',
    'notification',
    'log',
    'delay',
    'state-get',
    'state-set',
] as const;

export type NodeType = (typeof BUILTIN_NODE_TYPES)[number];

export const NodeTypeSchema = z.enum(BUILTIN_NODE_TYPES);

interface BuiltinNodeConfigMap {
    readonly 'file-watcher': FileWatcherConfig;
    readonly 'manual-trigger': ManualTriggerConfig;
    readonly 'if-else': IfElseConfig;
    readonly switch: SwitchConfig;
    readonly 'file-manager': FileManagerConfig;
    readonly notification: NotificationConfig;
    readonly log: LogConfig;
    readonly delay: DelayConfig;
    readonly 'state-get': StateGetConfig;
    readonly 'state-set': StateSetConfig;
}

export type BuiltinNodeConfig<K extends NodeType> = BuiltinNodeConfigMap[K];

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

function createBuiltinNodeSchema<TType extends NodeType, TSchema extends z.ZodType>(
    type: TType,
    configSchema: TSchema,
) {
    return z
        .object({
            id: PipelineNodeIdSchema,
            type: z.literal(type),
            config: configSchema,
        })
        .strict()
        .readonly();
}

type BuiltinNodeSchema = ReturnType<typeof createBuiltinNodeSchema>;
const builtinNodeSchemas = [
    createBuiltinNodeSchema('file-watcher', FileWatcherConfigSchema),
    createBuiltinNodeSchema('manual-trigger', ManualTriggerConfigSchema),
    createBuiltinNodeSchema('if-else', IfElseConfigSchema),
    createBuiltinNodeSchema('switch', SwitchConfigSchema),
    createBuiltinNodeSchema('file-manager', FileManagerConfigSchema),
    createBuiltinNodeSchema('notification', NotificationConfigSchema),
    createBuiltinNodeSchema('log', LogConfigSchema),
    createBuiltinNodeSchema('delay', DelayConfigSchema),
    createBuiltinNodeSchema('state-get', StateGetConfigSchema),
    createBuiltinNodeSchema('state-set', StateSetConfigSchema),
] as unknown as [BuiltinNodeSchema, ...BuiltinNodeSchema[]];

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

/** Structural Node validation. Plugin configuration admission remains domain-owned. */
export const PipelineNodeSchema: z.ZodType<PipelineNode> = z.union([
    PluginPipelineNodeSchema,
    BuiltinPipelineNodeSchema,
]);
