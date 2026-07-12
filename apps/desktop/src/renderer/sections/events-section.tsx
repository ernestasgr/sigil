import { type ReactElement, useMemo, useState } from 'react';

import { SectionShell } from '../components/section-shell.js';
import {
    eventColor,
    eventNameLabel,
    extractPluginId,
    formatTime,
    telemetryEntryContext,
    telemetryEntryPreview,
} from '../lib/event-display.js';
import type { BusEventEntry } from '../store/app-store.js';
import { useAppStore } from '../store/app-store.js';
import {
    formatTelemetryExport,
    isTelemetryDiagnostic,
    isTelemetryFailure,
} from '../store/telemetry-index.js';

interface FilterState {
    readonly eventType: string;
    readonly pluginId: string;
    readonly workflowId: string;
    readonly runId: string;
    readonly view: 'all' | 'failures' | 'diagnostics';
}

function parseFilterView(value: string): FilterState['view'] {
    switch (value) {
        case 'failures':
            return 'failures';
        case 'diagnostics':
            return 'diagnostics';
        default:
            return 'all';
    }
}

export function EventsSection(): ReactElement {
    const telemetryIndex = useAppStore((state) => state.telemetryIndex);
    const workflows = useAppStore((state) => state.workflows);
    const [filter, setFilter] = useState<FilterState>({
        eventType: '',
        pluginId: '',
        workflowId: '',
        runId: '',
        view: 'all',
    });
    const [copied, setCopied] = useState(false);

    const workflowIds = telemetryIndex.workflowIds;
    const runIds = useMemo(
        () => (filter.workflowId ? telemetryIndex.runIdsForWorkflow(filter.workflowId) : []),
        [filter.workflowId, telemetryIndex],
    );

    const scopedEvents = useMemo(() => {
        if (filter.workflowId) {
            return filter.runId
                ? telemetryIndex.forRun(filter.runId, filter.workflowId)
                : telemetryIndex.forWorkflow(filter.workflowId);
        }
        return telemetryIndex.entries;
    }, [filter.workflowId, filter.runId, telemetryIndex]);

    const eventTypes = useMemo(() => {
        const types = new Set<string>();
        for (const e of scopedEvents) {
            types.add(e.name);
        }
        return ['', ...types];
    }, [scopedEvents]);

    const pluginIds = useMemo(() => {
        const ids = new Set<string>();
        for (const e of scopedEvents) {
            const pid = e.telemetry?.pluginId ?? extractPluginId(e.payload);
            if (pid) ids.add(pid);
        }
        return ['', ...ids];
    }, [scopedEvents]);

    const filtered = useMemo(() => {
        let result: readonly BusEventEntry[] = scopedEvents;
        if (filter.eventType) {
            result = result.filter((e) => e.name === filter.eventType);
        }
        if (filter.pluginId) {
            result = result.filter(
                (e) => (e.telemetry?.pluginId ?? extractPluginId(e.payload)) === filter.pluginId,
            );
        }
        if (filter.view === 'failures') {
            result = result.filter(isTelemetryFailure);
        }
        if (filter.view === 'diagnostics') {
            result = result.filter(isTelemetryDiagnostic);
        }
        return result;
    }, [filter.eventType, filter.pluginId, filter.view, scopedEvents]);

    const reversed = useMemo(() => [...filtered].reverse(), [filtered]);

    const copySupportExport = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(formatTelemetryExport(filtered));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <SectionShell title="Events" subtitle="The live inspector — every echo on the Bus.">
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor="telemetry-view-filter"
                            className="font-ui text-veil text-xs tracking-widest uppercase"
                        >
                            View
                        </label>
                        <select
                            id="telemetry-view-filter"
                            className="bg-obsidian-ink border-gilt/40 text-parchment font-ui rounded-none border px-3 py-1.5 text-sm"
                            value={filter.view}
                            onChange={(e) =>
                                setFilter((prev) => ({
                                    ...prev,
                                    view: parseFilterView(e.target.value),
                                }))
                            }
                        >
                            <option value="all">All history</option>
                            <option value="failures">Failures only</option>
                            <option value="diagnostics">Diagnostics</option>
                        </select>
                    </div>
                    {workflowIds.length > 0 && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="workflow-filter"
                                className="font-ui text-veil text-xs tracking-widest uppercase"
                            >
                                Workflow
                            </label>
                            <select
                                id="workflow-filter"
                                className="bg-obsidian-ink border-gilt/40 text-parchment font-ui rounded-none border px-3 py-1.5 text-sm"
                                value={filter.workflowId}
                                onChange={(e) =>
                                    setFilter((prev) => ({
                                        ...prev,
                                        workflowId: e.target.value,
                                        runId: '',
                                        pluginId: '',
                                    }))
                                }
                            >
                                <option value="">All workflows</option>
                                {workflowIds.map((workflowId) => (
                                    <option key={workflowId} value={workflowId}>
                                        {workflows.find((workflow) => workflow.id === workflowId)
                                            ?.name ?? workflowId}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    {filter.workflowId && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="run-filter"
                                className="font-ui text-veil text-xs tracking-widest uppercase"
                            >
                                Run
                            </label>
                            <select
                                id="run-filter"
                                className="bg-obsidian-ink border-gilt/40 text-parchment font-ui rounded-none border px-3 py-1.5 text-sm"
                                value={filter.runId}
                                onChange={(e) =>
                                    setFilter((prev) => ({ ...prev, runId: e.target.value }))
                                }
                            >
                                <option value="">All runs</option>
                                {runIds.map((runId) => (
                                    <option key={runId} value={runId}>
                                        {runId}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor="event-type-filter"
                            className="font-ui text-veil text-xs tracking-widest uppercase"
                        >
                            Type
                        </label>
                        <select
                            id="event-type-filter"
                            className="bg-obsidian-ink border-gilt/40 text-parchment font-ui rounded-none border px-3 py-1.5 text-sm"
                            value={filter.eventType}
                            onChange={(e) =>
                                setFilter((prev) => ({ ...prev, eventType: e.target.value }))
                            }
                        >
                            <option value="">All types</option>
                            {eventTypes
                                .filter((t) => t !== '')
                                .map((t) => (
                                    <option key={t} value={t}>
                                        {eventNameLabel(t)}
                                    </option>
                                ))}
                        </select>
                    </div>
                    {pluginIds.length > 1 && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="plugin-filter"
                                className="font-ui text-veil text-xs tracking-widest uppercase"
                            >
                                Plugin
                            </label>
                            <select
                                id="plugin-filter"
                                className="bg-obsidian-ink border-gilt/40 text-parchment font-ui rounded-none border px-3 py-1.5 text-sm"
                                value={filter.pluginId}
                                onChange={(e) =>
                                    setFilter((prev) => ({ ...prev, pluginId: e.target.value }))
                                }
                            >
                                <option value="">All plugins</option>
                                {pluginIds
                                    .filter((p) => p !== '')
                                    .map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                            </select>
                        </div>
                    )}
                    <span className="font-ui text-veil ml-auto text-xs tracking-widest">
                        {filtered.length} event{filtered.length !== 1 ? 's' : ''}
                    </span>
                    <button
                        type="button"
                        className="font-ui text-gilt hover:text-parchment border-gilt/40 rounded-none border px-3 py-1.5 text-xs tracking-widest uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={filtered.length === 0}
                        onClick={() => void copySupportExport()}
                    >
                        {copied ? 'Copied' : 'Copy support export'}
                    </button>
                </div>

                <div className="border-gilt/40 border">
                    {reversed.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 py-8 text-center text-sm italic">
                            {telemetryIndex.entries.length === 0
                                ? 'No events yet. Enable a workflow or fire a test event to see Bus traffic appear in real time.'
                                : 'No events match the current filter.'}
                        </p>
                    ) : (
                        <ul className="divide-gilt/30 max-h-[600px] divide-y overflow-y-auto font-data">
                            {reversed.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="hover:bg-veil/5 flex items-start gap-3 px-4 py-2 text-sm transition-colors"
                                >
                                    <span className="text-veil mt-0.5 shrink-0 font-mono text-xs tabular-nums">
                                        {formatTime(entry.timestamp)}
                                    </span>
                                    <span
                                        className={`shrink-0 text-xs tracking-wider uppercase ${eventColor(entry.name)}`}
                                    >
                                        {eventNameLabel(entry.name)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-parchment truncate">
                                            {telemetryEntryPreview(entry)}
                                        </div>
                                        {telemetryEntryContext(entry) ? (
                                            <div className="text-veil mt-1 truncate text-[10px] uppercase">
                                                {telemetryEntryContext(entry)}
                                            </div>
                                        ) : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </SectionShell>
    );
}
