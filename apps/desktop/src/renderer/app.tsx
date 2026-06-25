import { useEffect, type ReactElement } from 'react';

import { Nav } from './components/nav.js';
import { SectionRouter } from './components/section-router.js';
import { useAppStore } from './store/app-store.js';

export function App(): ReactElement {
    const setWorkflows = useAppStore((state) => state.setWorkflows);
    const appendLog = useAppStore((state) => state.appendLog);
    const appendBusEvent = useAppStore((state) => state.appendBusEvent);

    useEffect(() => {
        const unsubscribeWorkflows = window.sigil.onWorkflowsList((workflows) => {
            setWorkflows(workflows);
        });
        const unsubscribeLogs = window.sigil.onEngineLog((line) => {
            appendLog(line);
        });
        const unsubscribeBusEvents = window.sigil.onBusEvent((event) => {
            appendBusEvent(event);
        });
        return () => {
            unsubscribeWorkflows();
            unsubscribeLogs();
            unsubscribeBusEvents();
        };
    }, [setWorkflows, appendLog, appendBusEvent]);

    return (
        <div className="flex h-full">
            <Nav />
            <main className="flex-1 overflow-hidden">
                <SectionRouter />
            </main>
        </div>
    );
}
