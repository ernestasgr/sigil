import type { ReactElement } from 'react';
import { isWorkflowActive } from '../../shared/workflow.js';
import { SectionShell } from '../components/section-shell.js';
import { eventColor, eventNameLabel, formatTime, payloadPreview } from '../lib/event-display.js';
import { useAppStore } from '../store/app-store.js';

export function HomeSection(): ReactElement {
    const workflows = useAppStore((state) => state.workflows);
    const busEvents = useAppStore((state) => state.busEvents);
    const logs = useAppStore((state) => state.logs);

    const activeWorkflows = workflows.filter(isWorkflowActive);
    const recentEvents = [...busEvents.slice(-10)].reverse();

    return (
        <SectionShell title="Home" subtitle="The working table — active sigils and recent echoes.">
            <div className="flex flex-col gap-6">
                <div className="border-gilt/40 border">
                    <h2 className="border-gilt/40 border-b font-ui text-veil px-4 py-2 text-xs tracking-widest uppercase">
                        Active sigils — {activeWorkflows.length}
                    </h2>
                    {activeWorkflows.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 py-3 text-sm italic">
                            No live workflows active — enable one from the Workflows section.
                        </p>
                    ) : (
                        <ul className="divide-gilt/30 divide-y font-ui">
                            {activeWorkflows.map((wf) => (
                                <li
                                    key={wf.id}
                                    className="flex items-center gap-3 px-4 py-2 text-sm"
                                >
                                    <span className="bg-verdigris inline-block h-2 w-2 shrink-0" />
                                    <span className="text-parchment truncate">{wf.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="border-gilt/40 border">
                    <h2 className="border-gilt/40 border-b font-ui text-veil px-4 py-2 text-xs tracking-widest uppercase">
                        Recent echoes
                    </h2>
                    {recentEvents.length === 0 && logs.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 py-3 text-sm italic">
                            No events yet — fire the trigger or toggle a workflow from the tray.
                        </p>
                    ) : (
                        <ul className="divide-gilt/30 divide-y font-data">
                            {recentEvents.length > 0
                                ? recentEvents.map((entry) => (
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
                                  ))
                                : logs.slice(-10).map((entry) => (
                                      <li
                                          key={entry.id}
                                          className="text-parchment px-4 py-1.5 text-sm"
                                      >
                                          {entry.line}
                                      </li>
                                  ))}
                        </ul>
                    )}
                </div>
            </div>
        </SectionShell>
    );
}
