import { z } from 'zod';

import type { NodeDescriptor } from './types.js';

import type { FileWatcherConfig } from './file-watcher.js';
import type { ManualTriggerConfig } from './manual-trigger.js';
import type { IfElseConfig } from './if-else.js';
import type { SwitchConfig } from './switch.js';
import type { FileManagerConfig } from './file-manager.js';
import type { NotificationConfig } from './notification.js';
import type { LogConfig } from './log.js';
import type { DelayConfig } from './delay.js';
import type { StateGetConfig } from './state-get.js';
import type { StateSetConfig } from './state-set.js';

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
    SwitchConfig,
};

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

// ─── PipelineNode type (derived from NODE_DESCRIPTORS) ──────────

type NodeConfigMap = {
    'file-watcher': FileWatcherConfig;
    'manual-trigger': ManualTriggerConfig;
    'if-else': IfElseConfig;
    switch: SwitchConfig;
    'file-manager': FileManagerConfig;
    notification: NotificationConfig;
    log: LogConfig;
    delay: DelayConfig;
    'state-get': StateGetConfig;
    'state-set': StateSetConfig;
};

export type PipelineNode = {
    [K in NodeType]: {
        readonly id: string;
        readonly type: K;
        readonly config: NodeConfigMap[K];
    };
}[NodeType];

// ─── PipelineNodeSchema (derived from NODE_DESCRIPTORS) ─────────

const nodeSchemas = Object.values(NODE_DESCRIPTORS).map((descriptor) =>
    z.object({
        id: z.string().min(1),
        type: z.literal(descriptor.type),
        config: descriptor.configSchema,
    }),
);

export const PipelineNodeSchema = z.discriminatedUnion(
    'type',
    nodeSchemas as unknown as readonly [z.ZodObject<any, any>, ...z.ZodObject<any, any>[]],
) as unknown as z.ZodType<PipelineNode>;

// ─── Output ports ───────────────────────────────────────────────

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    return nodeDescriptors[node.type].getOutputPorts(node.config);
}
