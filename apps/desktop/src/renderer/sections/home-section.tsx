import type { ReactElement } from 'react';
import { isWorkflowActive, sigilGlyphState } from '../../shared/workflow.js';
import { PanelHeading } from '../components/panel-heading.js';
import { SectionShell } from '../components/section-shell.js';
import { SigilFrame } from '../components/sigil-frame.js';
import { SigilGlyph } from '../components/sigil-glyph.js';
import {
    eventColor,
    eventNameLabel,
    formatTime,
    telemetryEntryPreview,
} from '../lib/event-display.js';
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
                <SigilFrame>
                    <PanelHeading>Active sigils — {activeWorkflows.length}</PanelHeading>
                    {activeWorkflows.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 pt-2 pb-3 text-sm italic">
                            No live workflows active — enable one from the Workflows section, or
                            retry any failed activations.
                        </p>
                    ) : (
                        <ul className="divide-gilt/30 divide-y font-ui">
                            {activeWorkflows.map((wf) => (
                                <li
                                    key={wf.id}
                                    className="flex items-center gap-3 px-4 py-2 text-sm"
                                >
                                    <SigilGlyph
                                        seed={wf.id}
                                        state={sigilGlyphState(wf.activation)}
                                        size={20}
                                        className="shrink-0"
                                    />
                                    <span className="text-parchment truncate">{wf.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </SigilFrame>

                <SigilFrame>
                    <PanelHeading>Recent echoes</PanelHeading>
                    {recentEvents.length === 0 && logs.length === 0 ? (
                        <p className="font-manuscript text-veil px-4 pt-2 pb-3 text-sm italic">
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
                                              {telemetryEntryPreview(entry)}
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
                </SigilFrame>
            </div>
        </SectionShell>
    );
}
