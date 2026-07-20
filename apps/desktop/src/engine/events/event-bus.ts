import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import { Subject } from 'rxjs';
import {
    type EngineDiagnosticPayload,
    EngineDiagnosticPayloadSchema,
    type LogOutputPayload,
    LogOutputPayloadSchema,
    type NodeCompletedPayload,
    NodeCompletedPayloadSchema,
    type NodeStartedPayload,
    NodeStartedPayloadSchema,
    type NotificationShowPayload,
    NotificationShowPayloadSchema,
    type PluginBusEventPayload,
    PluginBusEventPayloadSchema,
    type WorkflowCancelledPayload,
    WorkflowCancelledPayloadSchema,
    type WorkflowDroppedPayload,
    WorkflowDroppedPayloadSchema,
    type WorkflowErrorPayload,
    WorkflowErrorPayloadSchema,
    type WorkflowQueuedPayload,
    WorkflowQueuedPayloadSchema,
    type WorkflowRunPayload,
    WorkflowRunPayloadSchema,
    type WorkflowRunPolicyPayload,
    WorkflowRunPolicyPayloadSchema,
} from '../shared/event-payload-schemas.js';
import type { EventTelemetry } from '../shared/telemetry.js';

// Re-export derived types for consumers
export type {
    EngineDiagnosticPayload,
    LogOutputPayload,
    NodeCompletedPayload,
    NodeStartedPayload,
    NotificationShowPayload,
    PluginBusEventPayload,
    WorkflowCancelledPayload,
    WorkflowDroppedPayload,
    WorkflowErrorPayload,
    WorkflowQueuedPayload,
    WorkflowRunPayload,
    WorkflowRunPolicyPayload,
};

// Re-export schemas for consumers that need them
export {
    EngineDiagnosticPayloadSchema,
    LogOutputPayloadSchema,
    NodeCompletedPayloadSchema,
    NodeStartedPayloadSchema,
    NotificationShowPayloadSchema,
    PluginBusEventPayloadSchema,
    WorkflowCancelledPayloadSchema,
    WorkflowDroppedPayloadSchema,
    WorkflowErrorPayloadSchema,
    WorkflowQueuedPayloadSchema,
    WorkflowRunPayloadSchema,
    WorkflowRunPolicyPayloadSchema,
};

interface BusEventEnvelope<TName extends string, TPayload> {
    readonly name: TName;
    readonly payload: TPayload;
    readonly timestamp?: number;
    readonly telemetry?: EventTelemetry;
}

export type BusEvent =
    | BusEventEnvelope<'workflow.started', WorkflowRunPayload>
    | BusEventEnvelope<'workflow.completed', WorkflowRunPayload>
    | BusEventEnvelope<'workflow.error', WorkflowErrorPayload>
    | BusEventEnvelope<'workflow.queued', WorkflowQueuedPayload>
    | BusEventEnvelope<'workflow.dropped', WorkflowDroppedPayload>
    | BusEventEnvelope<'workflow.cancelled', WorkflowCancelledPayload>
    | BusEventEnvelope<'node.started', NodeStartedPayload>
    | BusEventEnvelope<'node.completed', NodeCompletedPayload>
    | BusEventEnvelope<'manual.trigger.fired', FileEventPayload>
    | BusEventEnvelope<'log.output', LogOutputPayload>
    | BusEventEnvelope<'notification.show', NotificationShowPayload>
    | BusEventEnvelope<'plugin.event', PluginBusEventPayload>
    | BusEventEnvelope<'engine.diagnostic', EngineDiagnosticPayload>;

export interface EventSink {
    readonly next: (event: BusEvent) => void | Promise<void>;
}

export type EventBus = Subject<BusEvent>;

export function createEventBus(): EventBus {
    return new Subject<BusEvent>();
}
