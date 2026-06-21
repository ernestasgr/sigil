import { z } from 'zod';
import {
    DelayConfigSchema,
    FileManagerConfigSchema,
    FileWatcherConfigSchema,
    IfElseConfigSchema,
    LogConfigSchema,
    ManualTriggerConfigSchema,
    NotificationConfigSchema,
    StateGetConfigSchema,
    StateSetConfigSchema,
    SwitchConfigSchema,
} from './node-configs.js';

export const NodeTypeSchema = z.enum([
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
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

const FileWatcherNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('file-watcher'),
    config: FileWatcherConfigSchema,
});

const ManualTriggerNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('manual-trigger'),
    config: ManualTriggerConfigSchema,
});

const IfElseNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('if-else'),
    config: IfElseConfigSchema,
});

const SwitchNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('switch'),
    config: SwitchConfigSchema,
});

const FileManagerNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('file-manager'),
    config: FileManagerConfigSchema,
});

const NotificationNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('notification'),
    config: NotificationConfigSchema,
});

const LogNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('log'),
    config: LogConfigSchema,
});

const DelayNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('delay'),
    config: DelayConfigSchema,
});

const StateGetNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('state-get'),
    config: StateGetConfigSchema,
});

const StateSetNodeSchema = z.object({
    id: z.string().min(1),
    type: z.literal('state-set'),
    config: StateSetConfigSchema,
});

export const PipelineNodeSchema = z.discriminatedUnion('type', [
    FileWatcherNodeSchema,
    ManualTriggerNodeSchema,
    IfElseNodeSchema,
    SwitchNodeSchema,
    FileManagerNodeSchema,
    NotificationNodeSchema,
    LogNodeSchema,
    DelayNodeSchema,
    StateGetNodeSchema,
    StateSetNodeSchema,
]);
export type PipelineNode = z.infer<typeof PipelineNodeSchema>;

export const StaticNodeOutputPorts = {
    'file-watcher': ['out'],
    'manual-trigger': ['out'],
    'if-else': ['true', 'false'],
    'file-manager': ['out'],
    notification: ['out'],
    log: ['out'],
    delay: ['out'],
    'state-get': ['out'],
    'state-set': ['out'],
} as const satisfies Record<Exclude<NodeType, 'switch'>, readonly string[]>;

export type NodeOutputPorts = typeof StaticNodeOutputPorts;

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    if (node.type === 'switch') {
        return ['default', ...node.config.cases];
    }
    return StaticNodeOutputPorts[node.type];
}
