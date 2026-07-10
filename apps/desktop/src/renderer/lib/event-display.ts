import { EventPayloadSchemaRegistry } from '../../engine/event-payload-schemas.js';

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

export function payloadPreview(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return String(payload);
    const obj = payload as Record<string, unknown>;

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

export function extractPluginId(payload: unknown): string | undefined {
    if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
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
