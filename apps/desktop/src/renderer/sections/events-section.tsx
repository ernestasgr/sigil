import { type ReactElement, useMemo, useState } from 'react';

import { SectionShell } from '../components/section-shell.js';
import {
    eventColor,
    eventNameLabel,
    extractPluginId,
    formatTime,
    payloadPreview,
} from '../lib/event-display.js';
import type { BusEventEntry } from '../store/app-store.js';
import { useAppStore } from '../store/app-store.js';

interface FilterState {
    readonly eventType: string;
    readonly pluginId: string;
    readonly workflowId: string;
    readonly runId: string;
}

export function EventsSection(): ReactElement {
    const busEvents = useAppStore((state) => state.busEvents);
    const telemetryIndex = useAppStore((state) => state.telemetryIndex);
    const workflows = useAppStore((state) => state.workflows);
    const [filter, setFilter] = useState<FilterState>({
        eventType: '',
        pluginId: '',
        workflowId: '',
        runId: '',
    });

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
        return busEvents;
    }, [busEvents, filter.workflowId, filter.runId, telemetryIndex]);

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
        return result;
    }, [filter.eventType, filter.pluginId, scopedEvents]);

    const reversed = useMemo(() => [...filtered].reverse(), [filtered]);

    return (
        <SectionShell title="Events" subtitle="The live inspector — every echo on the Bus.">
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
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
                </div>

                <div className="border-gilt/40 border">
                    {reversed.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 py-8 text-center text-sm italic">
                            {busEvents.length === 0
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
                                    <span className="text-parchment truncate">
                                        {entry.telemetry?.summary ?? payloadPreview(entry.payload)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </SectionShell>
    );
}
