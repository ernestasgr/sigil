import { z } from 'zod';
import { FileEventPayloadSchema } from './file-event-payload.js';
import { PipelineConditionSchema } from './conditions.js';

// ─── NodeDescriptor type ───

/**
 * Schema‑layer descriptor for a Node type.
 *
 * Each registered descriptor carries the canonical config schema,
 * the default configuration (Node Default), and a function that
 * computes output ports for a given config.
 *
 * `getOutputPorts` receives `unknown` because the registry erases
 * the per‑type config binding — the single call‑site
 * (`outputPortsForNode`) passes a `PipelineNode` whose config is
 * already guaranteed correct by the discriminated‑union validator.
 * Implementations that need the config (currently only `switch`)
 * narrow it with a justified `as`.
 */
export interface NodeDescriptor<TType extends string, TConfig> {
    readonly type: TType;
    readonly configSchema: z.ZodType<TConfig>;
    readonly defaultConfig: TConfig;
    readonly getOutputPorts: (config: unknown) => readonly string[];
}

export function defineNode<TType extends string, TConfig>(
    descriptor: NodeDescriptor<TType, TConfig>,
): NodeDescriptor<TType, TConfig> {
    return descriptor;
}

// ─── Node type identifiers ───

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

// ─── Config schemas (moved from node-configs.ts) ───

const FileEventNameSchema = z.enum(['file.created', 'file.modified', 'file.deleted']);

export const FileWatcherConfigSchema = z.object({
    path: z.string().min(1),
    recursive: z.boolean(),
    events: z.array(FileEventNameSchema).min(1),
    ignorePatterns: z.array(z.string()).optional(),
});
export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;

export const ManualTriggerConfigSchema = z.object({
    eventName: FileEventNameSchema,
    payload: FileEventPayloadSchema,
});
export type ManualTriggerConfig = z.infer<typeof ManualTriggerConfigSchema>;

export const IfElseConfigSchema = z.object({
    condition: PipelineConditionSchema,
});
export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;

const EventNameSwitchSchema = z.object({
    target: z.literal('event'),
    cases: z.array(z.string().min(1)),
});

const FieldSwitchSchema = z.object({
    target: z.enum(['payload', 'vars']),
    field: z.string().min(1),
    cases: z.array(z.string().min(1)),
});

export const SwitchConfigSchema = z
    .union([EventNameSwitchSchema, FieldSwitchSchema])
    .refine((cfg) => new Set(cfg.cases).size === cfg.cases.length, {
        message: 'switch cases must be unique',
        path: ['cases'],
    });
export type SwitchConfig = z.infer<typeof SwitchConfigSchema>;

export const FileManagerConfigSchema = z.object({
    action: z.enum(['move', 'rename', 'copy']),
    destination: z.string().min(1),
    onConflict: z.enum(['skip', 'overwrite', 'auto-rename', 'error']),
});
export type FileManagerConfig = z.infer<typeof FileManagerConfigSchema>;

export const NotificationConfigSchema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
});
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export const LogConfigSchema = z.object({
    message: z.string().min(1),
});
export type LogConfig = z.infer<typeof LogConfigSchema>;

export const DelayConfigSchema = z.object({
    ms: z.number().nonnegative(),
});
export type DelayConfig = z.infer<typeof DelayConfigSchema>;

export const StateGetConfigSchema = z.object({
    key: z.string().min(1),
    assignTo: z.string().min(1),
});
export type StateGetConfig = z.infer<typeof StateGetConfigSchema>;

export const StateSetConfigSchema = z.object({
    key: z.string().min(1),
    valueTemplate: z.string(),
});
export type StateSetConfig = z.infer<typeof StateSetConfigSchema>;

// ─── Per‑type descriptor constants ───

const FileWatcherDescriptor = defineNode({
    type: 'file-watcher',
    configSchema: FileWatcherConfigSchema,
    defaultConfig: { path: '/', recursive: true, events: ['file.created'] },
    getOutputPorts: () => ['out'],
});

const ManualTriggerDescriptor = defineNode({
    type: 'manual-trigger',
    configSchema: ManualTriggerConfigSchema,
    defaultConfig: {
        eventName: 'file.created',
        payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
    },
    getOutputPorts: () => ['out'],
});

const IfElseDescriptor = defineNode({
    type: 'if-else',
    configSchema: IfElseConfigSchema,
    defaultConfig: {
        condition: { target: 'event', operator: 'equals', value: 'file.created' },
    },
    getOutputPorts: () => ['true', 'false'],
});

const SwitchDescriptor = defineNode({
    type: 'switch',
    configSchema: SwitchConfigSchema,
    defaultConfig: { target: 'event', cases: ['file.created'] },
    getOutputPorts: (config) => {
        // Justified `as`: the descriptor knows its own config type, and
        // the registry erases TConfig to `unknown` so the lookup is uniform.
        const { cases } = config as SwitchConfig;
        return ['default', ...cases];
    },
});

const FileManagerDescriptor = defineNode({
    type: 'file-manager',
    configSchema: FileManagerConfigSchema,
    defaultConfig: { action: 'move', destination: '/', onConflict: 'skip' },
    getOutputPorts: () => ['out'],
});

const NotificationDescriptor = defineNode({
    type: 'notification',
    configSchema: NotificationConfigSchema,
    defaultConfig: { title: 'Notification', body: 'Body' },
    getOutputPorts: () => ['out'],
});

const LogDescriptor = defineNode({
    type: 'log',
    configSchema: LogConfigSchema,
    defaultConfig: { message: 'Log message' },
    getOutputPorts: () => ['out'],
});

const DelayDescriptor = defineNode({
    type: 'delay',
    configSchema: DelayConfigSchema,
    defaultConfig: { ms: 1000 },
    getOutputPorts: () => ['out'],
});

const StateGetDescriptor = defineNode({
    type: 'state-get',
    configSchema: StateGetConfigSchema,
    defaultConfig: { key: 'key', assignTo: 'value' },
    getOutputPorts: () => ['out'],
});

const StateSetDescriptor = defineNode({
    type: 'state-set',
    configSchema: StateSetConfigSchema,
    defaultConfig: { key: 'key', valueTemplate: '' },
    getOutputPorts: () => ['out'],
});

// ─── Registry ───

/** Erased registry type — `getOutputPorts` accepts `unknown` uniformly. */
type DescriptorRegistry = {
    readonly [K in NodeType]: NodeDescriptor<K, unknown>;
};

/** Registry with concrete per‑descriptor types (keys match {@link NodeType}). */
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

/** Registry view for uniform lookup (erased to `unknown` config). */
const nodeDescriptors: DescriptorRegistry = NODE_DESCRIPTORS;

export function getNodeDescriptor(type: NodeType): NodeDescriptor<NodeType, unknown> {
    return nodeDescriptors[type];
}

// ─── PipelineNode type (explicit union of all node variants) ───

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

// ─── Node schemas for validation ───

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
) as any;

// ─── Output ports ───

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    return nodeDescriptors[node.type].getOutputPorts(node.config);
}
