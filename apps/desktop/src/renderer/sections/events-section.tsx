import { useMemo, useState, type ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';
import type { BusEventEntry } from '../store/app-store.js';
import { useAppStore } from '../store/app-store.js';

function eventNameLabel(name: string): string {
    switch (name) {
        case 'workflow.started':
            return 'Workflow Started';
        case 'workflow.completed':
            return 'Workflow Completed';
        case 'workflow.error':
            return 'Workflow Error';
        case 'manual.trigger.fired':
            return 'Manual Trigger';
        case 'log.output':
            return 'Log';
        case 'notification.show':
            return 'Notification';
        case 'plugin.event':
            return 'Plugin Event';
        default:
            return name;
    }
}

function eventColor(name: string): string {
    switch (name) {
        case 'workflow.started':
            return 'text-gilt';
        case 'workflow.completed':
            return 'text-verdigris';
        case 'workflow.error':
            return 'text-old-blood';
        case 'manual.trigger.fired':
            return 'text-gilt';
        case 'log.output':
            return 'text-veil';
        case 'notification.show':
            return 'text-gilt';
        case 'plugin.event':
            return 'text-veil';
        default:
            return 'text-veil';
    }
}

function payloadPreview(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return String(payload);
    const obj = payload as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.pipelineId === 'string') parts.push(`pipeline=${obj.pipelineId}`);
    if (typeof obj.pluginId === 'string') parts.push(`plugin=${obj.pluginId}`);
    if (typeof obj.eventName === 'string') parts.push(`event=${obj.eventName}`);
    if (typeof obj.path === 'string') parts.push(`path=${obj.path}`);
    if (typeof obj.name === 'string') parts.push(`name=${obj.name}`);
    if (typeof obj.nodeId === 'string') parts.push(`node=${obj.nodeId}`);
    if (typeof obj.title === 'string') parts.push(`title=${obj.title}`);
    if (parts.length === 0) return JSON.stringify(payload).slice(0, 80);
    return parts.join(', ');
}

function extractPluginId(payload: unknown): string | undefined {
    if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        if (typeof obj.pluginId === 'string') return obj.pluginId;
    }
    return undefined;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

interface FilterState {
    readonly eventType: string;
    readonly pluginId: string;
}

export function EventsSection(): ReactElement {
    const busEvents = useAppStore((state) => state.busEvents);
    const [filter, setFilter] = useState<FilterState>({ eventType: '', pluginId: '' });

    const eventTypes = useMemo(() => {
        const types = new Set<string>();
        for (const e of busEvents) {
            types.add(e.name);
        }
        return ['', ...types];
    }, [busEvents]);

    const pluginIds = useMemo(() => {
        const ids = new Set<string>();
        for (const e of busEvents) {
            const pid = extractPluginId(e.payload);
            if (pid) ids.add(pid);
        }
        return ['', ...ids];
    }, [busEvents]);

    const filtered = useMemo(() => {
        let result: readonly BusEventEntry[] = busEvents;
        if (filter.eventType) {
            result = result.filter((e) => e.name === filter.eventType);
        }
        if (filter.pluginId) {
            result = result.filter((e) => extractPluginId(e.payload) === filter.pluginId);
        }
        return result;
    }, [busEvents, filter]);

    const reversed = useMemo(() => [...filtered].reverse(), [filtered]);

    return (
        <SectionShell title="Events" subtitle="The live inspector — every echo on the Bus.">
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label className="font-ui text-veil text-xs tracking-widest uppercase">
                            Type
                        </label>
                        <select
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
                            <label className="font-ui text-veil text-xs tracking-widest uppercase">
                                Plugin
                            </label>
                            <select
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
                                        {payloadPreview(entry.payload)}
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
