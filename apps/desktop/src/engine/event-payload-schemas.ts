import { z } from 'zod';

import { FileEventPayloadSchema, type FileEventPayload } from '@sigil/schema/file-event-payload';
import { Either } from 'effect';

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

type EventPayloadMap = {
    'workflow.started': WorkflowRunPayload;
    'workflow.completed': WorkflowRunPayload;
    'workflow.error': WorkflowErrorPayload;
    'manual.trigger.fired': FileEventPayload;
    'log.output': LogOutputPayload;
    'notification.show': NotificationShowPayload;
    'plugin.event': PluginBusEventPayload;
    'engine.diagnostic': EngineDiagnosticPayload;
};

type EventName = keyof EventPayloadMap;

export interface EventPayloadMetadata {
    readonly label: string;
    readonly color: string;
}

export interface EventPayloadSchemaEntry<TPayload> extends EventPayloadMetadata {
    readonly schema: z.ZodType<TPayload>;
}

type EventPayloadSchemaRegistryShape = {
    readonly [Name in EventName]: EventPayloadSchemaEntry<EventPayloadMap[Name]>;
} & Readonly<Record<string, EventPayloadMetadata>>;

const EVENT_PAYLOAD_SCHEMA_REGISTRY = {
    'workflow.started': {
        schema: WorkflowRunPayloadSchema,
        label: 'Workflow Started',
        color: 'text-gilt',
    },
    'workflow.completed': {
        schema: WorkflowRunPayloadSchema,
        label: 'Workflow Completed',
        color: 'text-verdigris',
    },
    'workflow.error': {
        schema: WorkflowErrorPayloadSchema,
        label: 'Workflow Error',
        color: 'text-old-blood',
    },
    'manual.trigger.fired': {
        schema: FileEventPayloadSchema,
        label: 'Manual Trigger',
        color: 'text-gilt',
    },
    'log.output': {
        schema: LogOutputPayloadSchema,
        label: 'Log',
        color: 'text-veil',
    },
    'notification.show': {
        schema: NotificationShowPayloadSchema,
        label: 'Notification',
        color: 'text-gilt',
    },
    'plugin.event': {
        schema: PluginBusEventPayloadSchema,
        label: 'Plugin Event',
        color: 'text-veil',
    },
    'engine.diagnostic': {
        schema: EngineDiagnosticPayloadSchema,
        label: 'Engine Diagnostic',
        color: 'text-veil',
    },
} satisfies {
    readonly [Name in EventName]: EventPayloadSchemaEntry<EventPayloadMap[Name]>;
};

export const EventPayloadSchemaRegistry: EventPayloadSchemaRegistryShape =
    EVENT_PAYLOAD_SCHEMA_REGISTRY;

function isEventName(name: string): name is EventName {
    return Object.keys(EventPayloadSchemaRegistry).includes(name);
}

export function safeParsePayload<Name extends EventName>(
    name: Name,
    payload: unknown,
): Either.Either<EventPayloadMap[Name], string>;
export function safeParsePayload(name: string, payload: unknown): Either.Either<unknown, string>;
export function safeParsePayload(name: string, payload: unknown): Either.Either<unknown, string> {
    if (!isEventName(name)) {
        return Either.left(`Unknown event name: ${name}`);
    }

    const result = EventPayloadSchemaRegistry[name].schema.safeParse(payload);
    return result.success
        ? Either.right(result.data)
        : Either.left(`Invalid payload for ${name}: ${result.error.message}`);
}

export function validateBusEventPayload(
    name: string,
    payload: unknown,
): Either.Either<void, string> {
    if (!isEventName(name)) {
        return Either.left(`Unknown event name: ${name}`);
    }

    const result = EventPayloadSchemaRegistry[name].schema.safeParse(payload);
    return result.success
        ? Either.right(undefined)
        : Either.left(`Invalid payload for ${name}: ${result.error.message}`);
}
