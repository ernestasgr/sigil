import { Either } from 'effect';

import {
    EventPayloadSchemaRegistry,
    safeParsePayload,
} from '../../engine/event-payload-schemas.js';
import { redactTelemetrySummary, redactTelemetryText } from '../../shared/telemetry-safety.js';
import type { BusEventEntry } from '../store/app-store.js';

export function eventNameLabel(name: string): string {
    return EventPayloadSchemaRegistry[name]?.label ?? name;
}

export function eventColor(name: string): string {
    return EventPayloadSchemaRegistry[name]?.color ?? 'text-veil';
}

const PAYLOAD_FIELDS = [
    ['pipeline', 'pipelineId'],
    ['plugin', 'pluginId'],
    ['event', 'eventName'],
    ['path', 'path'],
    ['name', 'name'],
    ['node', 'nodeId'],
    ['title', 'title'],
    ['kind', 'kind'],
] as const satisfies readonly (readonly [string, string])[];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function formatPayloadPreview(payload: unknown): string {
    if (!isRecord(payload)) return String(payload);
    const obj = payload;

    if (typeof obj.message === 'string') {
        return typeof obj.kind === 'string' ? `${obj.message} (${obj.kind})` : obj.message;
    }

    const parts = PAYLOAD_FIELDS.filter(([, key]) => typeof obj[key] === 'string').map(
        ([label, key]) => `${label}=${obj[key]}`,
    );

    if (parts.length === 0) {
        try {
            return JSON.stringify(payload).slice(0, 80);
        } catch {
            return '[unserializable payload]';
        }
    }
    return parts.join(', ');
}

export function payloadPreview(payload: unknown): string;
export function payloadPreview(name: string, payload: unknown): string;
export function payloadPreview(
    ...args: [payload: unknown] | [name: string, payload: unknown]
): string {
    if (args.length === 1) {
        return formatPayloadPreview(args[0]);
    }

    const [name, payload] = args;
    const parsed = safeParsePayload(name, payload);
    return Either.isRight(parsed)
        ? formatPayloadPreview(parsed.right)
        : formatPayloadPreview(payload);
}

export function telemetryEntryPreview(entry: BusEventEntry): string {
    if (entry.telemetry) return redactTelemetrySummary(entry.telemetry.summary);
    if (entry.name === 'engine.diagnostic') {
        const parsed = safeParsePayload('engine.diagnostic', entry.payload);
        if (Either.isRight(parsed)) return redactTelemetryText(parsed.right.message);
    }
    return payloadPreview(entry.name, entry.payload);
}

export function telemetryEntryContext(entry: BusEventEntry): string {
    const parsed =
        entry.name === 'engine.diagnostic'
            ? safeParsePayload('engine.diagnostic', entry.payload)
            : undefined;
    const diagnostic = parsed !== undefined && Either.isRight(parsed) ? parsed.right : undefined;
    const workflowId = entry.telemetry?.workflowId ?? diagnostic?.workflowId;
    const runId = entry.telemetry?.runId ?? diagnostic?.runId;
    const pluginId = entry.telemetry?.pluginId ?? diagnostic?.pluginId;
    const outcome = entry.telemetry?.outcome ?? diagnostic?.outcome;
    const source = diagnostic?.source;
    return [
        workflowId === undefined ? undefined : `workflow=${workflowId}`,
        runId === undefined ? undefined : `run=${runId}`,
        pluginId === undefined ? undefined : `plugin=${pluginId}`,
        outcome === undefined ? undefined : `outcome=${outcome}`,
        source === undefined ? undefined : `source=${source}`,
    ]
        .filter((value): value is string => value !== undefined)
        .join(' · ');
}

function extractPluginIdFromPayload(payload: unknown): string | undefined {
    if (isRecord(payload)) {
        const obj = payload;
        if (typeof obj.pluginId === 'string') return obj.pluginId;
    }
    return undefined;
}

export function extractPluginId(payload: unknown): string | undefined;
export function extractPluginId(name: string, payload: unknown): string | undefined;
export function extractPluginId(
    ...args: [payload: unknown] | [name: string, payload: unknown]
): string | undefined {
    if (args.length === 1) {
        return extractPluginIdFromPayload(args[0]);
    }

    const [name, payload] = args;
    const parsed = safeParsePayload(name, payload);
    if (Either.isRight(parsed)) return extractPluginIdFromPayload(parsed.right);
    if (!Object.hasOwn(EventPayloadSchemaRegistry, name)) {
        return extractPluginIdFromPayload(payload);
    }
    return undefined;
}

export function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}
