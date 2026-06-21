import { z } from 'zod';
import { FileEventPayloadSchema } from './file-event-payload.js';
import { PipelineConditionSchema } from './conditions.js';

const FileEventSchema = z.enum(['file.created', 'file.modified', 'file.deleted']);

export const FileWatcherConfigSchema = z.object({
    path: z.string().min(1),
    recursive: z.boolean(),
    events: z.array(FileEventSchema).min(1),
    ignorePatterns: z.array(z.string()).optional(),
});
export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;

export const ManualTriggerConfigSchema = z.object({
    payload: FileEventPayloadSchema,
});
export type ManualTriggerConfig = z.infer<typeof ManualTriggerConfigSchema>;

export const IfElseConfigSchema = z.object({
    condition: PipelineConditionSchema,
});
export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;

export const SwitchConfigSchema = z
    .object({
        target: z.enum(['event', 'vars']),
        field: z.string().min(1),
        cases: z.array(z.string().min(1)),
    })
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
