import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import type { EventTelemetry } from '../../shared/telemetry.js';

/** The renderer keeps recent telemetry only; older entries are evicted first. */
export const TELEMETRY_EVENT_CAP = 500;

export interface TelemetryEntry {
    readonly id: number;
    readonly name: string;
    readonly payload: unknown;
    readonly timestamp: number;
    readonly telemetry?: EventTelemetry;
}

export interface TelemetryIndex {
    readonly entries: readonly TelemetryEntry[];
    readonly workflowIds: readonly string[];
    readonly append: (entry: TelemetryEntry) => TelemetryIndex;
    readonly forWorkflow: (workflowId: string) => readonly TelemetryEntry[];
    readonly forRun: (runId: string, workflowId?: string) => readonly TelemetryEntry[];
    readonly runIdsForWorkflow: (workflowId: string) => readonly string[];
}

function normalizeTimestamp(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Date.now();
}

export function createTelemetryEntry(
    id: number,
    event: EngineBusEventPayload,
    receiptTimestamp: number = Date.now(),
): TelemetryEntry {
    const timestamp = normalizeTimestamp(
        event.telemetry?.timestamp ?? event.timestamp ?? receiptTimestamp,
    );

    return {
        id,
        name: event.name,
        payload: event.payload,
        timestamp,
        ...(event.telemetry === undefined ? {} : { telemetry: event.telemetry }),
    };
}

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
    const entries = map.get(key);
    if (entries) {
        entries.push(value);
        return;
    }
    map.set(key, [value]);
}

function buildIndex(entries: readonly TelemetryEntry[], cap: number): TelemetryIndex {
    const workflowEntries = new Map<string, TelemetryEntry[]>();
    const runEntries = new Map<string, TelemetryEntry[]>();
    const workflowRunIds = new Map<string, string[]>();
    const workflowIds: string[] = [];

    for (const entry of entries) {
        const workflowId = entry.telemetry?.workflowId;
        if (workflowId === undefined) continue;

        if (!workflowEntries.has(workflowId)) {
            workflowEntries.set(workflowId, []);
            workflowRunIds.set(workflowId, []);
            workflowIds.push(workflowId);
        }
        appendToMap(workflowEntries, workflowId, entry);

        const runId = entry.telemetry?.runId;
        if (runId === undefined) continue;
        appendToMap(runEntries, runId, entry);
        const runIds = workflowRunIds.get(workflowId);
        if (runIds && !runIds.includes(runId)) runIds.push(runId);
    }

    return {
        entries,
        workflowIds,
        append: (entry) => {
            const nextEntries =
                entries.length < cap
                    ? [...entries, entry]
                    : [...entries.slice(entries.length - cap + 1), entry];
            return buildIndex(nextEntries, cap);
        },
        forWorkflow: (workflowId) => workflowEntries.get(workflowId) ?? [],
        forRun: (runId, workflowId) => {
            if (workflowId !== undefined) {
                return (workflowEntries.get(workflowId) ?? []).filter(
                    (entry) => entry.telemetry?.runId === runId,
                );
            }
            return runEntries.get(runId) ?? [];
        },
        runIdsForWorkflow: (workflowId) => workflowRunIds.get(workflowId) ?? [],
    };
}

export function createTelemetryIndex(cap: number = TELEMETRY_EVENT_CAP): TelemetryIndex {
    if (!Number.isInteger(cap) || cap <= 0) {
        throw new Error('Telemetry index cap must be a positive integer');
    }
    return buildIndex([], cap);
}
