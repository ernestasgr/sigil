import { Subject } from 'rxjs';

import type { FileEventPayload } from '@sigil/schema/file-event-payload';

export interface LogOutputPayload {
    readonly message: string;
}

export interface WorkflowRunPayload {
    readonly pipelineId: string;
}

export interface PluginBusEventPayload {
    readonly pluginId: string;
    readonly eventName: string;
    readonly data: Readonly<Record<string, unknown>>;
}

export type BusEvent =
    | { readonly name: 'workflow.started'; readonly payload: WorkflowRunPayload }
    | { readonly name: 'workflow.completed'; readonly payload: WorkflowRunPayload }
    | { readonly name: 'manual.trigger.fired'; readonly payload: FileEventPayload }
    | { readonly name: 'log.output'; readonly payload: LogOutputPayload }
    | { readonly name: 'plugin.event'; readonly payload: PluginBusEventPayload };

export type EventBus = Subject<BusEvent>;

export function createEventBus(): EventBus {
    return new Subject<BusEvent>();
}
