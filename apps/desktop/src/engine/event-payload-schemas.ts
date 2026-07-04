import { z } from 'zod';

import { FileEventPayloadSchema } from '@sigil/schema/file-event-payload';

export const WorkflowRunPayloadSchema = z
    .object({
        pipelineId: z.string(),
    })
    .readonly();
export type WorkflowRunPayload = z.infer<typeof WorkflowRunPayloadSchema>;

export const WorkflowErrorPayloadSchema = z
    .object({
        pipelineId: z.string(),
        nodeId: z.string(),
        message: z.string(),
    })
    .readonly();
export type WorkflowErrorPayload = z.infer<typeof WorkflowErrorPayloadSchema>;

export const LogOutputPayloadSchema = z
    .object({
        message: z.string(),
    })
    .readonly();
export type LogOutputPayload = z.infer<typeof LogOutputPayloadSchema>;

export const NotificationShowPayloadSchema = z
    .object({
        title: z.string(),
        body: z.string(),
    })
    .readonly();
export type NotificationShowPayload = z.infer<typeof NotificationShowPayloadSchema>;

export const PluginBusEventPayloadSchema = z
    .object({
        pluginId: z.string(),
        eventName: z.string(),
        data: z.record(z.string(), z.unknown()),
    })
    .readonly();
export type PluginBusEventPayload = z.infer<typeof PluginBusEventPayloadSchema>;

export const EngineDiagnosticPayloadSchema = z
    .object({
        message: z.string(),
        kind: z.string().optional(),
    })
    .readonly();
export type EngineDiagnosticPayload = z.infer<typeof EngineDiagnosticPayloadSchema>;

export interface EventPayloadSchemaEntry {
    readonly schema: z.ZodTypeAny;
    readonly label: string;
    readonly color: string;
}

export const EventPayloadSchemaRegistry: Record<string, EventPayloadSchemaEntry> = {
    'workflow.started': {
        schema: WorkflowRunPayloadSchema,
        label: 'Workflow Started',
        color: 'text-gilt',
    } satisfies EventPayloadSchemaEntry,
    'workflow.completed': {
        schema: WorkflowRunPayloadSchema,
        label: 'Workflow Completed',
        color: 'text-verdigris',
    } satisfies EventPayloadSchemaEntry,
    'workflow.error': {
        schema: WorkflowErrorPayloadSchema,
        label: 'Workflow Error',
        color: 'text-old-blood',
    } satisfies EventPayloadSchemaEntry,
    'manual.trigger.fired': {
        schema: FileEventPayloadSchema,
        label: 'Manual Trigger',
        color: 'text-gilt',
    } satisfies EventPayloadSchemaEntry,
    'log.output': {
        schema: LogOutputPayloadSchema,
        label: 'Log',
        color: 'text-veil',
    } satisfies EventPayloadSchemaEntry,
    'notification.show': {
        schema: NotificationShowPayloadSchema,
        label: 'Notification',
        color: 'text-gilt',
    } satisfies EventPayloadSchemaEntry,
    'plugin.event': {
        schema: PluginBusEventPayloadSchema,
        label: 'Plugin Event',
        color: 'text-veil',
    } satisfies EventPayloadSchemaEntry,
    'engine.diagnostic': {
        schema: EngineDiagnosticPayloadSchema,
        label: 'Engine Diagnostic',
        color: 'text-veil',
    } satisfies EventPayloadSchemaEntry,
};

export function safeParsePayload(
    name: string,
    payload: unknown,
): { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: string } {
    const entry = EventPayloadSchemaRegistry[name];
    if (!entry) {
        return { ok: false, error: `Unknown event name: ${name}` };
    }
    const result = entry.schema.safeParse(payload);
    if (result.success) {
        return { ok: true, data: result.data };
    }
    return { ok: false, error: result.error.message };
}

export function validateBusEventPayload(name: string, payload: unknown): string | undefined {
    const entry = EventPayloadSchemaRegistry[name];
    if (!entry) {
        return `Unknown event name: ${name}`;
    }
    const result = entry.schema.safeParse(payload);
    if (!result.success) {
        return `Invalid payload for ${name}: ${result.error.message}`;
    }
    return undefined;
}
