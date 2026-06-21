import { useEffect, useState, type ReactElement } from 'react';

type LogEntry = { readonly id: number; readonly line: string };

export function App(): ReactElement {
    const [logs, setLogs] = useState<readonly LogEntry[]>([]);

    useEffect(() => {
        const unsubscribe = window.sigil.onEngineLog((line) => {
            setLogs((prev) => [...prev, { id: prev.length, line }]);
        });
        return () => {
            unsubscribe();
        };
    }, []);

    const handleFire = (): void => {
        void window.sigil.fireTestEvent();
    };

    return (
        <div className="flex h-full flex-col items-center gap-8 p-8">
            <header className="text-center">
                <h1 className="font-display text-4xl tracking-[0.3em] text-gilt uppercase">
                    Sigil
                </h1>
                <p className="font-manuscript text-veil mt-2 text-lg italic">
                    Tracer: manual-trigger → log
                </p>
            </header>

            <button
                type="button"
                onClick={handleFire}
                className="border-gilt text-gilt hover:bg-gilt/10 px-6 py-2 text-sm tracking-widest uppercase border transition-colors"
            >
                Fire test event
            </button>

            <section className="border-gilt/40 w-full max-w-2xl border">
                <h2 className="font-ui text-veil border-gilt/40 border-b px-4 py-2 text-xs tracking-widest uppercase">
                    Engine log
                </h2>
                <ul className="font-data divide-gilt/30 divide-y">
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
            </section>
        </div>
    );
}
