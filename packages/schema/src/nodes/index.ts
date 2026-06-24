import { z } from 'zod';

import type { NodeDescriptor } from './types.js';

import {
    FileWatcherConfigSchema,
    type FileWatcherConfig,
    FileWatcherDescriptor,
} from './file-watcher.js';
import {
    ManualTriggerConfigSchema,
    type ManualTriggerConfig,
    ManualTriggerDescriptor,
} from './manual-trigger.js';
import { IfElseConfigSchema, type IfElseConfig, IfElseDescriptor } from './if-else.js';
import { SwitchConfigSchema, type SwitchConfig, SwitchDescriptor } from './switch.js';
import {
    FileManagerConfigSchema,
    type FileManagerConfig,
    FileManagerDescriptor,
} from './file-manager.js';
import {
    NotificationConfigSchema,
    type NotificationConfig,
    NotificationDescriptor,
} from './notification.js';
import { LogConfigSchema, type LogConfig, LogDescriptor } from './log.js';
import { DelayConfigSchema, type DelayConfig, DelayDescriptor } from './delay.js';
import { StateGetConfigSchema, type StateGetConfig, StateGetDescriptor } from './state-get.js';
import { StateSetConfigSchema, type StateSetConfig, StateSetDescriptor } from './state-set.js';

// ─── Re-exports ─────────────────────────────────────────────────

export { FileWatcherConfigSchema, type FileWatcherConfig };
export { ManualTriggerConfigSchema, type ManualTriggerConfig };
export { IfElseConfigSchema, type IfElseConfig };
export { SwitchConfigSchema, type SwitchConfig };
export { FileManagerConfigSchema, type FileManagerConfig };
export { NotificationConfigSchema, type NotificationConfig };
export { LogConfigSchema, type LogConfig };
export { DelayConfigSchema, type DelayConfig };
export { StateGetConfigSchema, type StateGetConfig };
export { StateSetConfigSchema, type StateSetConfig };

// ─── Node type identifiers ──────────────────────────────────────

const NODE_TYPES = [
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

export type NodeType = (typeof NODE_TYPES)[number];

export const NodeTypeSchema = z.enum(NODE_TYPES);

// ─── Registry ───────────────────────────────────────────────────

type DescriptorRegistry = {
    readonly [K in NodeType]: NodeDescriptor<K, unknown>;
};

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
} as const satisfies DescriptorRegistry;

const nodeDescriptors: DescriptorRegistry = NODE_DESCRIPTORS;

export function getNodeDescriptor(type: NodeType): NodeDescriptor<NodeType, unknown> {
    return nodeDescriptors[type];
}

// ─── PipelineNode type ──────────────────────────────────────────

export type PipelineNode =
    | { id: string; type: 'file-watcher'; config: FileWatcherConfig }
    | { id: string; type: 'manual-trigger'; config: ManualTriggerConfig }
    | { id: string; type: 'if-else'; config: IfElseConfig }
    | { id: string; type: 'switch'; config: SwitchConfig }
    | { id: string; type: 'file-manager'; config: FileManagerConfig }
    | { id: string; type: 'notification'; config: NotificationConfig }
    | { id: string; type: 'log'; config: LogConfig }
    | { id: string; type: 'delay'; config: DelayConfig }
    | { id: string; type: 'state-get'; config: StateGetConfig }
    | { id: string; type: 'state-set'; config: StateSetConfig };

// ─── Zod schema ─────────────────────────────────────────────────

const nodeSchemas = [
    z.object({
        id: z.string().min(1),
        type: z.literal('file-watcher'),
        config: FileWatcherConfigSchema,
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal('manual-trigger'),
        config: ManualTriggerConfigSchema,
    }),
    z.object({ id: z.string().min(1), type: z.literal('if-else'), config: IfElseConfigSchema }),
    z.object({ id: z.string().min(1), type: z.literal('switch'), config: SwitchConfigSchema }),
    z.object({
        id: z.string().min(1),
        type: z.literal('file-manager'),
        config: FileManagerConfigSchema,
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal('notification'),
        config: NotificationConfigSchema,
    }),
    z.object({ id: z.string().min(1), type: z.literal('log'), config: LogConfigSchema }),
    z.object({ id: z.string().min(1), type: z.literal('delay'), config: DelayConfigSchema }),
    z.object({ id: z.string().min(1), type: z.literal('state-get'), config: StateGetConfigSchema }),
    z.object({ id: z.string().min(1), type: z.literal('state-set'), config: StateSetConfigSchema }),
] as const;

// The `as any` cast is justified: TypeScript's declaration emitter
// resolves ZodObject's config-field type to ZodType<{...}> inside
// generic type arguments, losing literal‑enum fidelity.  By annotating
// the schema with the explicit PipelineNode union, consumers get
// the correct inferred types from the declaration file.
export const PipelineNodeSchema: z.ZodType<PipelineNode> = z.discriminatedUnion(
    'type',
    nodeSchemas,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

// ─── Output ports ───────────────────────────────────────────────

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    return nodeDescriptors[node.type].getOutputPorts(node.config);
}
