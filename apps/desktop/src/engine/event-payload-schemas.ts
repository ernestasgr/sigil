import { type FileEventPayload, FileEventPayloadSchema } from '@sigil/schema/file-event-payload';
import { Either } from 'effect';
import { z } from 'zod';

export type { EventTelemetry } from '../shared/telemetry.js';
export { EventTelemetrySchema } from '../shared/telemetry.js';

export const WorkflowRunPayloadSchema = z
    .object({
        pipelineId: z.string(),
        workflowId: z.string().optional(),
        runId: z.string().optional(),
        outcome: z.enum(['succeeded', 'failed', 'cancelled']).optional(),
    })
    .readonly();
export type WorkflowRunPayload = z.infer<typeof WorkflowRunPayloadSchema>;

export const WorkflowErrorPayloadSchema = z
    .object({
        pipelineId: z.string(),
        workflowId: z.string().optional(),
        runId: z.string().optional(),
        nodeId: z.string(),
        nodeType: z.string().optional(),
        pluginId: z.string().optional(),
        message: z.string(),
        outcome: z.literal('failed').optional(),
    })
    .readonly();
export type WorkflowErrorPayload = z.infer<typeof WorkflowErrorPayloadSchema>;

export const WorkflowRunPolicyPayloadSchema = z
    .object({
        concurrency: z.number().int().positive(),
        queueLimit: z.number().int().nonnegative(),
        overflow: z.literal('drop-newest'),
    })
    .readonly();
export type WorkflowRunPolicyPayload = z.infer<typeof WorkflowRunPolicyPayloadSchema>;

const WorkflowAdmissionPayloadFields = {
    pipelineId: z.string(),
    workflowId: z.string(),
    runId: z.string(),
    queueSize: z.number().int().nonnegative(),
    policy: WorkflowRunPolicyPayloadSchema,
} as const;

export const WorkflowQueuedPayloadSchema = z
    .object({
        ...WorkflowAdmissionPayloadFields,
        outcome: z.literal('queued').optional(),
    })
    .readonly();
export type WorkflowQueuedPayload = z.infer<typeof WorkflowQueuedPayloadSchema>;

export const WorkflowDroppedPayloadSchema = z
    .object({
        ...WorkflowAdmissionPayloadFields,
        reason: z.enum(['queue_full', 'not_accepting']),
        outcome: z.literal('dropped').optional(),
    })
    .readonly();
export type WorkflowDroppedPayload = z.infer<typeof WorkflowDroppedPayloadSchema>;

export const WorkflowCancelledPayloadSchema = z
    .object({
        pipelineId: z.string(),
        workflowId: z.string().optional(),
        runId: z.string().optional(),
        phase: z.enum(['queued', 'running']).optional(),
        reason: z.string(),
        outcome: z.literal('cancelled').optional(),
    })
    .readonly();
export type WorkflowCancelledPayload = z.infer<typeof WorkflowCancelledPayloadSchema>;

export const NodeRunPayloadSchema = z
    .object({
        pipelineId: z.string(),
        workflowId: z.string().optional(),
        runId: z.string().optional(),
        nodeId: z.string(),
        nodeType: z.string(),
        outcome: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
        durationMs: z.number().finite().nonnegative().optional(),
        message: z.string().max(256).optional(),
    })
    .readonly();
export type NodeRunPayload = z.infer<typeof NodeRunPayloadSchema>;

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
    'workflow.queued': WorkflowQueuedPayload;
    'workflow.dropped': WorkflowDroppedPayload;
    'workflow.cancelled': WorkflowCancelledPayload;
    'node.started': NodeRunPayload;
    'node.completed': NodeRunPayload;
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
    'workflow.queued': {
        schema: WorkflowQueuedPayloadSchema,
        label: 'Workflow Queued',
        color: 'text-gilt',
    },
    'workflow.dropped': {
        schema: WorkflowDroppedPayloadSchema,
        label: 'Workflow Dropped',
        color: 'text-old-blood',
    },
    'workflow.cancelled': {
        schema: WorkflowCancelledPayloadSchema,
        label: 'Workflow Cancelled',
        color: 'text-veil',
    },
    'node.started': {
        schema: NodeRunPayloadSchema,
        label: 'Node Started',
        color: 'text-gilt',
    },
    'node.completed': {
        schema: NodeRunPayloadSchema,
        label: 'Node Completed',
        color: 'text-verdigris',
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
