import { useEffect, useState, type ReactElement } from 'react';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';

type EngineStatus = 'idle' | 'pinging' | 'ok' | 'error';

export function App(): ReactElement {
    const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
    const [pongReceivedAt, setPongReceivedAt] = useState<number | null>(null);

    useEffect(() => {
        const sigil = (
            window as unknown as {
                sigil?: { pingEngine: () => Promise<{ receivedAt: number } | null> };
            }
        ).sigil;
        if (!sigil) {
            setEngineStatus('error');
            return;
        }
        setEngineStatus('pinging');
        sigil
            .pingEngine()
            .then((pong) => {
                if (pong) {
                    setPongReceivedAt(pong.receivedAt);
                    setEngineStatus('ok');
                } else {
                    setEngineStatus('error');
                }
            })
            .catch(() => setEngineStatus('error'));
    }, []);

    const statusColor =
        engineStatus === 'ok'
            ? 'text-verdigris'
            : engineStatus === 'error'
              ? 'text-old-blood'
              : 'text-veil';

    const statusLabel =
        engineStatus === 'ok'
            ? 'Engine online'
            : engineStatus === 'error'
              ? 'Engine offline'
              : engineStatus === 'pinging'
                ? 'Pinging engine…'
                : 'Idle';

    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
            <header className="text-center">
                <h1 className="font-display text-4xl tracking-[0.3em] text-gilt uppercase">
                    Sigil
                </h1>
                <p className="font-manuscript text-veil mt-2 text-lg italic">
                    A local-first automation platform.
                </p>
            </header>

            <div className="border-veil/40 text-data text-sm flex items-center gap-3 rounded-sm border px-4 py-3">
                <span className={statusColor}>●</span>
                <span>{statusLabel}</span>
                {pongReceivedAt !== null && (
                    <span className="text-veil">
                        {' '}
                        (pong @ {new Date(pongReceivedAt).toLocaleTimeString()})
                    </span>
                )}
            </div>

            <div className="text-data text-veil max-w-md text-xs">
                <p>Schema sample loaded: {sampleManualTriggerToLog.id}</p>
                <p>Nodes: {sampleManualTriggerToLog.nodes.map((n) => n.type).join(' → ')}</p>
            </div>
        </div>
    );
}
