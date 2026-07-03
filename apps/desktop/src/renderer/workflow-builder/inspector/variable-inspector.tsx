import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useWorkflowState } from '../../lib/use-workflow-state.js';
import { useAppStore, type LogEntry } from '../../store/app-store.js';

interface VariableInspectorProps {
    readonly workflowId: string;
}

export function VariableInspector({ workflowId }: VariableInspectorProps): ReactElement {
    const { entries: stateEntries, loading: stateLoading, refresh: refreshState } =
        useWorkflowState(workflowId);
    const [activeTab, setActiveTab] = useState<'state' | 'output'>('output');
    const allLogs = useAppStore((state) => state.logs);
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [allLogs]);

    const recentLogs: readonly LogEntry[] = allLogs.slice(-50);

    return (
        <div className="flex h-full flex-col">
            <header className="border-gilt/40 flex border-b">
                <button
                    type="button"
                    onClick={() => setActiveTab('output')}
                    className={`font-ui px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        activeTab === 'output'
                            ? 'border-gilt text-gilt border-b'
                            : 'text-veil hover:text-parchment'
                    }`}
                >
                    Output
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('state')}
                    className={`font-ui px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        activeTab === 'state'
                            ? 'border-gilt text-gilt border-b'
                            : 'text-veil hover:text-parchment'
                    }`}
                >
                    State
                </button>
            </header>

            <div className="flex-1 overflow-auto">
                {activeTab === 'output' ? (
                    <div className="flex flex-col">
                        {recentLogs.length === 0 ? (
                            <p className="font-manuscript text-veil p-4 text-xs italic">
                                No output yet. Run the workflow to see log messages and variable
                                changes.
                            </p>
                        ) : (
                            <div className="font-data divide-gilt/30 divide-y text-xs">
                                {recentLogs.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="hover:bg-veil/5 px-4 py-1.5 transition-colors"
                                    >
                                        {entry.line}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div ref={logEndRef} />
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 p-4">
                        {stateLoading ? (
                            <p className="font-manuscript text-veil text-xs italic">
                                Loading state...
                            </p>
                        ) : stateEntries.length === 0 ? (
                            <div className="flex flex-col gap-2">
                                <p className="font-manuscript text-veil text-xs italic">
                                    No state keys stored for this workflow.
                                </p>
                                <p className="font-data text-veil text-[10px]">
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
                                    <span className="font-ui text-veil text-[10px] tracking-widest uppercase">
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
