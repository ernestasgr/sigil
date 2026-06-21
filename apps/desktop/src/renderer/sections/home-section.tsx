import { useEffect, useRef, useState, type ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';
import { Button } from '../components/ui/button.js';

type LogEntry = { readonly id: number; readonly line: string };

export function HomeSection(): ReactElement {
    const [logs, setLogs] = useState<readonly LogEntry[]>([]);
    const nextId = useRef(0);

    useEffect(() => {
        const unsubscribe = window.sigil.onEngineLog((line) => {
            const id = nextId.current++;
            setLogs((prev) => [...prev, { id, line }]);
        });
        return () => {
            unsubscribe();
        };
    }, []);

    const handleFire = (): void => {
        void window.sigil.fireTestEvent();
    };

    return (
        <SectionShell title="Home" subtitle="The working table — active sigils and recent echoes.">
            <div className="flex flex-col gap-6">
                <Button onClick={handleFire}>Fire test event</Button>
                <div className="border-gilt/40 border">
                    <h2 className="border-gilt/40 border-b font-ui text-veil px-4 py-2 text-xs tracking-widest uppercase">
                        Engine log
                    </h2>
                    <ul className="divide-gilt/30 divide-y font-data">
                        {logs.length === 0 ? (
                            <li className="font-manuscript text-veil px-4 py-3 text-sm italic">
                                No events yet — fire the trigger to see a log line.
                            </li>
                        ) : (
                            logs.map((entry) => (
                                <li key={entry.id} className="text-parchment px-4 py-2 text-sm">
                                    {entry.line}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            </div>
        </SectionShell>
    );
}
