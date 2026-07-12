import { EventPayloadSchemaRegistry } from '../../engine/event-payload-schemas.js';
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

export function payloadPreview(payload: unknown): string {
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

export function telemetryEntryPreview(entry: BusEventEntry): string {
    if (entry.telemetry) return redactTelemetrySummary(entry.telemetry.summary);
    if (entry.name === 'engine.diagnostic' && isRecord(entry.payload)) {
        const message = entry.payload.message;
        if (typeof message === 'string') return redactTelemetryText(message);
    }
    return payloadPreview(entry.payload);
}

function diagnosticField(entry: BusEventEntry, key: string): string | undefined {
    if (entry.name !== 'engine.diagnostic' || !isRecord(entry.payload)) return undefined;
    const value = entry.payload[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function telemetryEntryContext(entry: BusEventEntry): string {
    const workflowId = entry.telemetry?.workflowId ?? diagnosticField(entry, 'workflowId');
    const runId = entry.telemetry?.runId ?? diagnosticField(entry, 'runId');
    const pluginId = entry.telemetry?.pluginId ?? diagnosticField(entry, 'pluginId');
    const outcome = entry.telemetry?.outcome ?? diagnosticField(entry, 'outcome');
    const source = diagnosticField(entry, 'source');
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

export function extractPluginId(payload: unknown): string | undefined {
    if (isRecord(payload)) {
        const obj = payload;
        if (typeof obj.pluginId === 'string') return obj.pluginId;
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
