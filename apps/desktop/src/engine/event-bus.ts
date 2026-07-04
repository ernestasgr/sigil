import { Subject } from 'rxjs';

import type { FileEventPayload } from '@sigil/schema/file-event-payload';

import {
    EngineDiagnosticPayloadSchema,
    LogOutputPayloadSchema,
    NotificationShowPayloadSchema,
    PluginBusEventPayloadSchema,
    WorkflowErrorPayloadSchema,
    WorkflowRunPayloadSchema,
    type EngineDiagnosticPayload,
    type LogOutputPayload,
    type NotificationShowPayload,
    type PluginBusEventPayload,
    type WorkflowErrorPayload,
    type WorkflowRunPayload,
} from './event-payload-schemas.js';

// Re-export derived types for consumers
export type {
    EngineDiagnosticPayload,
    LogOutputPayload,
    NotificationShowPayload,
    PluginBusEventPayload,
    WorkflowErrorPayload,
    WorkflowRunPayload,
};

// Re-export schemas for consumers that need them
export {
    EngineDiagnosticPayloadSchema,
    LogOutputPayloadSchema,
    NotificationShowPayloadSchema,
    PluginBusEventPayloadSchema,
    WorkflowErrorPayloadSchema,
    WorkflowRunPayloadSchema,
};

export type BusEvent =
    | { readonly name: 'workflow.started'; readonly payload: WorkflowRunPayload }
    | { readonly name: 'workflow.completed'; readonly payload: WorkflowRunPayload }
    | { readonly name: 'workflow.error'; readonly payload: WorkflowErrorPayload }
    | {
          readonly name: 'manual.trigger.fired';
          readonly payload: FileEventPayload;
      }
    | { readonly name: 'log.output'; readonly payload: LogOutputPayload }
    | { readonly name: 'notification.show'; readonly payload: NotificationShowPayload }
    | { readonly name: 'plugin.event'; readonly payload: PluginBusEventPayload }
    | { readonly name: 'engine.diagnostic'; readonly payload: EngineDiagnosticPayload };

export type EventBus = Subject<BusEvent>;

export function createEventBus(): EventBus {
    return new Subject<BusEvent>();
}
