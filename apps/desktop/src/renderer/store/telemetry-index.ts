import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import type {
    EventTelemetry,
    TelemetryDiagnosticSource,
    TelemetryOutcome,
} from '../../shared/telemetry.js';
import { redactTelemetrySummary, redactTelemetryText } from '../../shared/telemetry-safety.js';

/** The renderer keeps recent telemetry only; older entries are evicted first. */
export const TELEMETRY_EVENT_CAP = 500;
const SUPPORT_EXPORT_SCHEMA_VERSION = 1;

export interface TelemetryEntry {
    readonly id: number;
    readonly name: string;
    readonly payload: unknown;
    readonly timestamp: number;
    readonly telemetry?: EventTelemetry;
}

interface SupportTelemetryRecord {
    readonly eventId?: string;
    readonly name: string;
    readonly timestamp: number;
    readonly kind?: EventTelemetry['kind'];
    readonly diagnosticKind?: string;
    readonly source?: TelemetryDiagnosticSource;
    readonly severity?: EventTelemetry['severity'];
    readonly workflowId?: string;
    readonly pipelineId?: string;
    readonly runId?: string;
    readonly nodeId?: string;
    readonly nodeType?: string;
    readonly pluginId?: string;
    readonly outcome?: EventTelemetry['outcome'];
    readonly durationMs?: number;
    readonly summary: string;
}

export interface TelemetryIndex {
    readonly entries: readonly TelemetryEntry[];
    readonly workflowIds: readonly string[];
    readonly append: (entry: TelemetryEntry) => TelemetryIndex;
    readonly diagnostics: () => readonly TelemetryEntry[];
    readonly forWorkflow: (workflowId: string) => readonly TelemetryEntry[];
    readonly failuresForWorkflow: (workflowId: string) => readonly TelemetryEntry[];
    readonly forRun: (runId: string, workflowId?: string) => readonly TelemetryEntry[];
    readonly runIdsForWorkflow: (workflowId: string) => readonly string[];
}

export function isTelemetryFailure(entry: TelemetryEntry): boolean {
    return (
        entry.name === 'workflow.error' ||
        entry.telemetry?.severity === 'error' ||
        entry.telemetry?.outcome === 'failed' ||
        (entry.name === 'engine.diagnostic' &&
            isRecord(entry.payload) &&
            entry.payload.outcome === 'failed')
    );
}

export function isTelemetryDiagnostic(entry: TelemetryEntry): boolean {
    return entry.name === 'engine.diagnostic' || entry.telemetry?.kind === 'diagnostic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

function diagnosticSource(value: unknown): TelemetryDiagnosticSource | undefined {
    return value === 'engine' || value === 'worker' || value === 'plugin' ? value : undefined;
}

function diagnosticOutcome(value: unknown): TelemetryOutcome | undefined {
    return value === 'queued' ||
        value === 'running' ||
        value === 'succeeded' ||
        value === 'failed' ||
        value === 'cancelled' ||
        value === 'dropped'
        ? value
        : undefined;
}

function diagnosticMetadata(entry: TelemetryEntry): Partial<SupportTelemetryRecord> {
    if (entry.name !== 'engine.diagnostic' || !isRecord(entry.payload)) return {};

    const message = boundedString(entry.payload.message);
    const source = diagnosticSource(entry.payload.source);
    const kind = boundedString(entry.payload.kind);
    const pluginId = boundedString(entry.payload.pluginId);
    const workflowId = boundedString(entry.payload.workflowId);
    const pipelineId = boundedString(entry.payload.pipelineId);
    const runId = boundedString(entry.payload.runId);
    const nodeId = boundedString(entry.payload.nodeId);
    const nodeType = boundedString(entry.payload.nodeType);
    const outcome = diagnosticOutcome(entry.payload.outcome);

    return {
        ...(message === undefined ? {} : { summary: redactTelemetryText(message) }),
        ...(source === undefined ? {} : { source }),
        ...(kind === undefined ? {} : { diagnosticKind: kind }),
        ...(pluginId === undefined ? {} : { pluginId }),
        ...(workflowId === undefined ? {} : { workflowId }),
        ...(pipelineId === undefined ? {} : { pipelineId }),
        ...(runId === undefined ? {} : { runId }),
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(nodeType === undefined ? {} : { nodeType }),
        ...(outcome === undefined ? {} : { outcome }),
    };
}

function supportRecord(entry: TelemetryEntry): SupportTelemetryRecord {
    const telemetry = entry.telemetry;
    const diagnostic = diagnosticMetadata(entry);
    return {
        name: entry.name,
        timestamp: entry.timestamp,
        ...diagnostic,
        summary: telemetry
            ? redactTelemetrySummary(telemetry.summary)
            : (diagnostic.summary ?? '[PAYLOAD_OMITTED]'),
        ...(telemetry?.eventId === undefined ? {} : { eventId: telemetry.eventId }),
        ...(telemetry?.kind === undefined ? {} : { kind: telemetry.kind }),
        ...(telemetry?.severity === undefined ? {} : { severity: telemetry.severity }),
        ...(telemetry?.workflowId === undefined ? {} : { workflowId: telemetry.workflowId }),
        ...(telemetry?.pipelineId === undefined ? {} : { pipelineId: telemetry.pipelineId }),
        ...(telemetry?.runId === undefined ? {} : { runId: telemetry.runId }),
        ...(telemetry?.nodeId === undefined ? {} : { nodeId: telemetry.nodeId }),
        ...(telemetry?.nodeType === undefined ? {} : { nodeType: telemetry.nodeType }),
        ...(telemetry?.pluginId === undefined ? {} : { pluginId: telemetry.pluginId }),
        ...(telemetry?.outcome === undefined ? {} : { outcome: telemetry.outcome }),
        ...(telemetry?.durationMs === undefined ? {} : { durationMs: telemetry.durationMs }),
    };
}

export function formatTelemetryExport(entries: readonly TelemetryEntry[]): string {
    return JSON.stringify(
        {
            schemaVersion: SUPPORT_EXPORT_SCHEMA_VERSION,
            retention: {
                maxEntries: TELEMETRY_EVENT_CAP,
                eviction: 'oldest-first',
            },
            redaction: {
                payload: 'omitted',
                summaries: 'sensitive values replaced with [REDACTED]',
            },
            events: entries.map(supportRecord),
        },
        null,
        2,
    );
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
        diagnostics: () => entries.filter(isTelemetryDiagnostic),
        forWorkflow: (workflowId) => workflowEntries.get(workflowId) ?? [],
        failuresForWorkflow: (workflowId) =>
            (workflowEntries.get(workflowId) ?? []).filter(isTelemetryFailure),
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
