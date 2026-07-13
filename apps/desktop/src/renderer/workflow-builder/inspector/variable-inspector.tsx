import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    eventColor,
    eventNameLabel,
    formatTime,
    telemetryEntryContext,
    telemetryEntryPreview,
} from '../../lib/event-display.js';
import { useWorkflowState } from '../../lib/use-workflow-state.js';
import { type BusEventEntry, useAppStore } from '../../store/app-store.js';

interface VariableInspectorProps {
    readonly workflowId: string;
}

function isWorkflowOutput(entry: BusEventEntry): boolean {
    switch (entry.name) {
        case 'log.output':
        case 'workflow.completed':
        case 'workflow.error':
        case 'workflow.cancelled':
        case 'node.completed':
        case 'engine.diagnostic':
        case 'plugin.event':
            return true;
        default:
            return false;
    }
}

export function VariableInspector({ workflowId }: VariableInspectorProps): ReactElement {
    const {
        entries: stateEntries,
        loading: stateLoading,
        refresh: refreshState,
    } = useWorkflowState(workflowId);
    const [activeTab, setActiveTab] = useState<'state' | 'output'>('output');
    const telemetryIndex = useAppStore((state) => state.telemetryIndex);
    const logEndRef = useRef<HTMLDivElement>(null);

    const recentOutput = useMemo(
        () => telemetryIndex.forWorkflow(workflowId).filter(isWorkflowOutput).slice(-50),
        [telemetryIndex, workflowId],
    );

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    return (
        <div className="flex h-full flex-col">
            <header
                className="border-gilt/40 flex border-b"
                role="tablist"
                aria-label="Workflow runtime inspector"
            >
                <button
                    type="button"
                    id="workflow-output-tab"
                    role="tab"
                    aria-selected={activeTab === 'output'}
                    aria-controls="workflow-inspector-panel"
                    onClick={() => setActiveTab('output')}
                    className={`font-ui px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        activeTab === 'output'
                            ? 'border-gilt text-gilt border-b'
                            : 'text-veil-foreground hover:text-parchment'
                    }`}
                >
                    Output
                </button>
                <button
                    type="button"
                    id="workflow-state-tab"
                    role="tab"
                    aria-selected={activeTab === 'state'}
                    aria-controls="workflow-inspector-panel"
                    onClick={() => setActiveTab('state')}
                    className={`font-ui px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        activeTab === 'state'
                            ? 'border-gilt text-gilt border-b'
                            : 'text-veil-foreground hover:text-parchment'
                    }`}
                >
                    State
                </button>
            </header>

            <div
                id="workflow-inspector-panel"
                role="tabpanel"
                aria-labelledby={`workflow-${activeTab}-tab`}
                className="flex-1 overflow-auto"
            >
                {activeTab === 'output' ? (
                    <div className="flex flex-col">
                        {recentOutput.length === 0 ? (
                            <p className="font-manuscript text-veil-foreground p-4 text-xs italic">
                                No output yet. Run this Workflow to see its structured output.
                            </p>
                        ) : (
                            <div className="font-data divide-gilt/30 divide-y text-xs">
                                {recentOutput.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="hover:bg-veil/5 flex items-start gap-2 px-4 py-1.5 transition-colors"
                                    >
                                        <span className="text-veil-foreground shrink-0 font-mono text-[10px] tabular-nums">
                                            {formatTime(entry.timestamp)}
                                        </span>
                                        <span
                                            className={`shrink-0 text-[10px] tracking-wider uppercase ${eventColor(entry.name)}`}
                                        >
                                            {eventNameLabel(entry.name)}
                                        </span>
                                        <span className="text-parchment min-w-0 break-words">
                                            {telemetryEntryPreview(entry)}
                                            {telemetryEntryContext(entry) ? (
                                                <span className="text-veil-foreground ml-2 text-[10px] uppercase">
                                                    {telemetryEntryContext(entry)}
                                                </span>
                                            ) : null}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div ref={logEndRef} />
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 p-4">
                        {stateLoading ? (
                            <p className="font-manuscript text-veil-foreground text-xs italic">
                                Loading state...
                            </p>
                        ) : stateEntries.length === 0 ? (
                            <div className="flex flex-col gap-2">
                                <p className="font-manuscript text-veil-foreground text-xs italic">
                                    No state keys stored for this workflow.
                                </p>
                                <p className="font-data text-veil-foreground text-[10px]">
                                    State keys are created by State Set nodes during execution.
                                </p>
                                <button
                                    type="button"
                                    onClick={refreshState}
                                    className="font-ui text-gilt hover:text-gilt/80 mt-2 text-[10px] tracking-widest uppercase transition-colors"
                                >
                                    Refresh
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="font-ui text-veil-foreground text-[10px] tracking-widest uppercase">
                                        {stateEntries.length} key
                                        {stateEntries.length !== 1 ? 's' : ''}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={refreshState}
                                        className="font-ui text-gilt hover:text-gilt/80 text-[10px] tracking-widest uppercase transition-colors"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                {stateEntries.map((entry) => (
                                    <div
                                        key={entry.key}
                                        className="border-gilt/20 flex flex-col gap-0.5 border p-2"
                                    >
                                        <span className="font-ui text-gilt text-[10px] tracking-wider uppercase">
                                            {entry.key}
                                        </span>
                                        <span className="font-data text-parchment break-all text-xs">
                                            {entry.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
