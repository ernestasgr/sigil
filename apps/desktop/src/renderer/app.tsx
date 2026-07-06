import { useEffect, type ReactElement } from 'react';

import { Nav } from './components/nav.js';
import { SectionRouter } from './components/section-router.js';
import { useAppStore } from './store/app-store.js';
import { useSigil, SigilProvider } from './lib/sigil-context.js';

function AppInner(): ReactElement {
    const setWorkflows = useAppStore((state) => state.setWorkflows);
    const appendLog = useAppStore((state) => state.appendLog);
    const appendBusEvent = useAppStore((state) => state.appendBusEvent);
    const sigil = useSigil();

    useEffect(() => {
        const unsubscribeWorkflows = sigil.onWorkflowsList((workflows) => {
            setWorkflows(workflows);
        });
        const unsubscribeLogs = sigil.onEngineLog((line) => {
            appendLog(line);
        });
        const unsubscribeBusEvents = sigil.onBusEvent((event) => {
            appendBusEvent(event);
        });
        void sigil.rendererReady();
        return () => {
            unsubscribeWorkflows();
            unsubscribeLogs();
            unsubscribeBusEvents();
        };
    }, [setWorkflows, appendLog, appendBusEvent, sigil]);

    return (
        <div className="flex h-full">
            <Nav />
            <main className="flex-1 overflow-hidden">
                <SectionRouter />
            </main>
        </div>
    );
}

export function App(): ReactElement {
    return (
        <SigilProvider>
            <AppInner />
        </SigilProvider>
    );
}
