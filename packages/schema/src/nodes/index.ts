import { z } from 'zod';

import type { NodeDescriptor } from './types.js';

import { FileWatcherDescriptor } from './file-watcher.js';
import { ManualTriggerDescriptor } from './manual-trigger.js';
import { IfElseDescriptor } from './if-else.js';
import { SwitchDescriptor } from './switch.js';
import { FileManagerDescriptor } from './file-manager.js';
import { NotificationDescriptor } from './notification.js';
import { LogDescriptor } from './log.js';
import { DelayDescriptor } from './delay.js';
import { StateGetDescriptor } from './state-get.js';
import { StateSetDescriptor } from './state-set.js';

export type { DelayConfig } from './delay.js';
export type { FileManagerConfig } from './file-manager.js';
export type { FileWatcherConfig } from './file-watcher.js';
export type { IfElseConfig } from './if-else.js';
export type { LogConfig } from './log.js';
export type { ManualTriggerConfig } from './manual-trigger.js';
export type { NotificationConfig } from './notification.js';
export type { StateGetConfig } from './state-get.js';
export type { StateSetConfig } from './state-set.js';
export type { SwitchConfig } from './switch.js';
export type { NodeDescriptor } from './types.js';

// ─── Registry ───────────────────────────────────────────────────

const NODE_DESCRIPTORS = {
    'file-watcher': FileWatcherDescriptor,
    'manual-trigger': ManualTriggerDescriptor,
    'if-else': IfElseDescriptor,
    switch: SwitchDescriptor,
    'file-manager': FileManagerDescriptor,
    notification: NotificationDescriptor,
    log: LogDescriptor,
    delay: DelayDescriptor,
    'state-get': StateGetDescriptor,
    'state-set': StateSetDescriptor,
} as const;

export type NodeType = keyof typeof NODE_DESCRIPTORS;

type DescriptorRegistry = {
    readonly [K in NodeType]: NodeDescriptor<K, unknown>;
};

const nodeDescriptors: DescriptorRegistry = NODE_DESCRIPTORS;

export function getNodeDescriptor(type: NodeType): NodeDescriptor<NodeType, unknown> {
    return nodeDescriptors[type];
}

// ─── NodeTypeSchema ─────────────────────────────────────────────

const NODE_TYPE_VALUES = Object.keys(NODE_DESCRIPTORS) as unknown as readonly [
    NodeType,
    ...NodeType[],
];
export const NodeTypeSchema = z.enum(NODE_TYPE_VALUES);

// ─── BuiltinPipelineNode (derived from NODE_DESCRIPTORS) ────────

type NodeConfigMap = {
    [K in keyof typeof NODE_DESCRIPTORS]: z.infer<(typeof NODE_DESCRIPTORS)[K]['configSchema']>;
};

export type BuiltinPipelineNode = {
    [K in NodeType]: {
        readonly id: string;
        readonly type: K;
        readonly config: NodeConfigMap[K];
    };
}[NodeType];

// ─── PluginPipelineNode ─────────────────────────────────────────

export interface PluginPipelineNode {
    readonly id: string;
    readonly type: string;
    readonly pluginId: string;
    readonly config: unknown;
}

// ─── PipelineNode (builtin | plugin) ────────────────────────────

export type PipelineNode = BuiltinPipelineNode | PluginPipelineNode;

export function isPluginNode(node: PipelineNode): node is PluginPipelineNode {
    return 'pluginId' in node;
}

export function isBuiltinNode(node: PipelineNode): node is BuiltinPipelineNode {
    return !('pluginId' in node);
}

// ─── PipelineNodeSchema (derived from NODE_DESCRIPTORS) ─────────

const builtinNodeSchemas = Object.values(NODE_DESCRIPTORS).map((descriptor) =>
    z.object({
        id: z.string().min(1),
        type: z.literal(descriptor.type),
        config: descriptor.configSchema,
    }),
);

/* eslint-disable @typescript-eslint/no-explicit-any -- Zod discriminatedUnion requires a concrete tuple type; dynamic arrays need this cast */
const BuiltinPipelineNodeSchema = z.discriminatedUnion(
    'type',
    builtinNodeSchemas as unknown as readonly [z.ZodObject<any, any>, ...z.ZodObject<any, any>[]],
);
/* eslint-enable @typescript-eslint/no-explicit-any */

const PluginPipelineNodeSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    pluginId: z.string().min(1),
    config: z.unknown(),
});

export const PipelineNodeSchema = z.unknown().superRefine((data, ctx) => {
    if (typeof data !== 'object' || data === null) {
        ctx.addIssue({
            code: 'custom',
            message: 'Pipeline node must be an object',
            path: [],
        });
        return;
    }
    const obj = data as Record<string, unknown>;
    const isPlugin = 'pluginId' in obj && typeof obj.pluginId === 'string';
    const schema = isPlugin ? PluginPipelineNodeSchema : BuiltinPipelineNodeSchema;
    const result = schema.safeParse(data);
    if (!result.success) {
        for (const issue of result.error.issues) {
            ctx.addIssue({
                code: 'custom',
                message: issue.message,
                path: issue.path,
            });
        }
    }
}) as unknown as z.ZodType<PipelineNode>;

// ─── Output ports ───────────────────────────────────────────────

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    if (isPluginNode(node)) {
        return [];
    }
    return nodeDescriptors[node.type].getOutputPorts(node.config);
}
