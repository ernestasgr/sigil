import { randomUUID } from 'node:crypto';
import type { PipelineNode } from '@sigil/schema/nodes';
import type {
    EventTelemetry,
    TelemetryKind,
    TelemetryOutcome,
    TelemetrySeverity,
} from '../shared/telemetry.js';
import { isSensitiveTelemetryKey, redactTelemetryText } from '../shared/telemetry-safety.js';
import type {
    BusEvent,
    EventBus,
    EventSink,
    NodeCompletedPayload,
    NodeStartedPayload,
} from './event-bus.js';

const MAX_SUMMARY_LENGTH = 256;
const MAX_SUMMARY_STRING_LENGTH = 96;
const MAX_SUMMARY_DEPTH = 2;
const MAX_SUMMARY_ENTRIES = 16;
const MAX_SUMMARY_ARRAY_ITEMS = 8;

export interface RunTelemetryIdentity {
    readonly workflowId: string;
    readonly pipelineId: string;
    readonly runId: string;
}

export interface NodeTelemetryIdentity {
    readonly nodeId: string;
    readonly nodeType: string;
    readonly pluginId?: string;
}

export type NodeRunOutcome = Extract<TelemetryOutcome, 'succeeded' | 'failed' | 'cancelled'>;

export interface TelemetryEventOptions {
    readonly kind?: TelemetryKind;
    readonly severity?: TelemetrySeverity;
    readonly outcome?: TelemetryOutcome;
    readonly nodeId?: string;
    readonly nodeType?: string;
    readonly pluginId?: string;
    readonly durationMs?: number;
    readonly timestamp?: number;
}

export interface RunTelemetryOptions {
    readonly now?: () => number;
    readonly createEventId?: () => string;
}

export interface NodeTelemetrySpan {
    readonly finish: (outcome: NodeRunOutcome, message?: string) => void;
}

export interface NodeTelemetry {
    readonly identity: NodeTelemetryIdentity;
    readonly bus: EventSink;
    readonly start: () => NodeTelemetrySpan;
}

export interface RunTelemetry {
    readonly identity: RunTelemetryIdentity;
    readonly emit: (event: BusEvent, options?: TelemetryEventOptions) => void;
    readonly forNode: (identity: NodeTelemetryIdentity) => NodeTelemetry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function summaryValue(value: unknown, depth: number, key?: string): unknown {
    if (key && isSensitiveTelemetryKey(key)) return '[REDACTED]';
    if (value === null) return null;
    if (typeof value === 'string') {
        return truncate(safeTelemetryMessage(value), MAX_SUMMARY_STRING_LENGTH);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return Number.isFinite(value) ? value : '[UNAVAILABLE]';
    }
    if (typeof value === 'bigint') return '[UNAVAILABLE]';
    if (typeof value === 'undefined') return '[UNAVAILABLE]';
    if (typeof value === 'function' || typeof value === 'symbol') return '[UNAVAILABLE]';
    if (depth >= MAX_SUMMARY_DEPTH) return '[TRUNCATED]';

    if (Array.isArray(value)) {
        const values = value
            .slice(0, MAX_SUMMARY_ARRAY_ITEMS)
            .map((item) => summaryValue(item, depth + 1));
        if (value.length > MAX_SUMMARY_ARRAY_ITEMS) values.push('[TRUNCATED]');
        return values;
    }

    if (isRecord(value)) {
        const entries = Object.entries(value).slice(0, MAX_SUMMARY_ENTRIES);
        const result: Record<string, unknown> = {};
        for (const [entryKey, entryValue] of entries) {
            result[entryKey] = summaryValue(entryValue, depth + 1, entryKey);
        }
        if (Object.keys(value).length > MAX_SUMMARY_ENTRIES) result['…'] = '[TRUNCATED]';
        return result;
    }

    return '[UNAVAILABLE]';
}

function summarize(value: unknown): string {
    const reduced = summaryValue(value, 0);
    if (typeof reduced === 'string') return truncate(reduced, MAX_SUMMARY_LENGTH);
    try {
        return truncate(JSON.stringify(reduced) ?? '[UNAVAILABLE]', MAX_SUMMARY_LENGTH);
    } catch {
        return '[UNAVAILABLE]';
    }
}

function eventKind(name: BusEvent['name']): TelemetryKind {
    switch (name) {
        case 'workflow.started':
            return 'lifecycle';
        case 'workflow.queued':
        case 'workflow.dropped':
            return 'queue';
        case 'workflow.completed':
        case 'workflow.error':
        case 'workflow.cancelled':
            return 'outcome';
        case 'node.started':
        case 'node.completed':
        case 'manual.trigger.fired':
        case 'log.output':
        case 'notification.show':
            return 'node';
        case 'plugin.event':
            return 'plugin';
        case 'engine.diagnostic':
            return 'diagnostic';
        default:
            return assertNever(name);
    }
}

function eventOutcome(event: BusEvent): TelemetryOutcome | undefined {
    switch (event.name) {
        case 'workflow.started':
            return 'running';
        case 'workflow.completed':
            return event.payload.outcome;
        case 'workflow.error':
            return 'failed';
        case 'workflow.queued':
            return 'queued';
        case 'workflow.dropped':
            return 'dropped';
        case 'workflow.cancelled':
            return 'cancelled';
        case 'node.started':
        case 'node.completed':
            return event.payload.outcome;
        case 'manual.trigger.fired':
        case 'log.output':
        case 'notification.show':
        case 'plugin.event':
        case 'engine.diagnostic':
            return 'outcome' in event.payload ? event.payload.outcome : undefined;
        default:
            return assertNever(event);
    }
}

function eventSeverity(event: BusEvent, outcome: TelemetryOutcome | undefined): TelemetrySeverity {
    if (outcome === 'failed') return 'error';
    if (event.name === 'workflow.error') return 'error';
    if (event.name === 'engine.diagnostic') return 'warn';
    if (outcome === 'dropped') return 'warn';
    return 'info';
}

function eventTime(now: () => number): number {
    const value = now();
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Date.now();
}

function durationBetween(start: number, end: number): number {
    return Math.max(0, end - start);
}

function boundedMessage(message: string | undefined): string | undefined {
    return message === undefined ? undefined : safeTelemetryMessage(message);
}

export function safeTelemetryMessage(message: string): string {
    return redactTelemetryText(message, MAX_SUMMARY_LENGTH);
}

function nodeEventOptions(event: BusEvent, options: TelemetryEventOptions): TelemetryEventOptions {
    switch (event.name) {
        case 'plugin.event':
            return { ...options, kind: 'plugin' };
        case 'engine.diagnostic':
            return { ...options, kind: 'diagnostic' };
        default:
            return options;
    }
}

function nodePayload(
    identity: RunTelemetryIdentity,
    node: NodeTelemetryIdentity,
    outcome: 'running',
    durationMs?: undefined,
    message?: string,
): NodeStartedPayload;
function nodePayload(
    identity: RunTelemetryIdentity,
    node: NodeTelemetryIdentity,
    outcome: NodeRunOutcome,
    durationMs: number,
    message?: string,
): NodeCompletedPayload;
function nodePayload(
    identity: RunTelemetryIdentity,
    node: NodeTelemetryIdentity,
    outcome: NodeRunOutcome | 'running',
    durationMs?: number,
    message?: string,
): NodeStartedPayload | NodeCompletedPayload {
    const common = {
        ...identity,
        ...node,
    };
    const messagePayload = message === undefined ? {} : { message: boundedMessage(message) };
    if (outcome === 'running') {
        return { ...common, outcome, ...messagePayload };
    }
    if (durationMs === undefined) {
        throw new Error('Node completion telemetry requires a duration');
    }
    return { ...common, outcome, durationMs, ...messagePayload };
}

export function nodeTelemetryIdentity(node: PipelineNode): NodeTelemetryIdentity {
    if ('pluginId' in node) {
        return { nodeId: node.id, nodeType: node.type, pluginId: node.pluginId };
    }
    return { nodeId: node.id, nodeType: node.type };
}

export function createRunTelemetry(
    bus: EventBus,
    identity: RunTelemetryIdentity,
    options: RunTelemetryOptions = {},
): RunTelemetry {
    const now = options.now ?? Date.now;
    const createEventId = options.createEventId ?? randomUUID;

    function emit(event: BusEvent, eventOptions: TelemetryEventOptions = {}): void {
        const outcome = eventOptions.outcome ?? eventOutcome(event);
        const timestamp =
            eventOptions.timestamp === undefined || !Number.isFinite(eventOptions.timestamp)
                ? eventTime(now)
                : Math.max(0, Math.trunc(eventOptions.timestamp));
        const durationMs =
            eventOptions.durationMs === undefined || !Number.isFinite(eventOptions.durationMs)
                ? undefined
                : Math.max(0, eventOptions.durationMs);
        const metadata: EventTelemetry = {
            eventId: createEventId(),
            timestamp,
            kind: eventOptions.kind ?? eventKind(event.name),
            severity: eventOptions.severity ?? eventSeverity(event, outcome),
            ...identity,
            ...(eventOptions.nodeId === undefined ? {} : { nodeId: eventOptions.nodeId }),
            ...(eventOptions.nodeType === undefined ? {} : { nodeType: eventOptions.nodeType }),
            ...(eventOptions.pluginId === undefined ? {} : { pluginId: eventOptions.pluginId }),
            ...(outcome === undefined ? {} : { outcome }),
            ...(durationMs === undefined ? {} : { durationMs }),
            summary: summarize(event.payload),
        };

        try {
            bus.next({ ...event, timestamp: metadata.timestamp, telemetry: metadata });
        } catch {
            // Telemetry is observational. A subscriber cannot change execution.
        }
    }

    function forNode(node: NodeTelemetryIdentity): NodeTelemetry {
        const nodeOptions: TelemetryEventOptions = {
            kind: 'node',
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            ...(node.pluginId === undefined ? {} : { pluginId: node.pluginId }),
        };
        const nodeBus: EventSink = {
            next: (event) => {
                emit(event, nodeEventOptions(event, nodeOptions));
            },
        };

        return {
            identity: node,
            bus: nodeBus,
            start: () => {
                const startedAt = eventTime(now);
                emit(
                    {
                        name: 'node.started',
                        payload: nodePayload(identity, node, 'running'),
                    },
                    { ...nodeOptions, timestamp: startedAt },
                );

                let finished = false;
                return {
                    finish: (outcome, message) => {
                        if (finished) return;
                        finished = true;
                        const finishedAt = eventTime(now);
                        const durationMs = durationBetween(startedAt, finishedAt);
                        emit(
                            {
                                name: 'node.completed',
                                payload: nodePayload(identity, node, outcome, durationMs, message),
                            },
                            { ...nodeOptions, outcome, durationMs },
                        );
                    },
                };
            },
        };
    }

    return { identity, emit, forNode };
}

function assertNever(value: never): never {
    throw new Error(`Unhandled telemetry value: ${JSON.stringify(value)}`);
}
