import { useEffect, type ReactElement } from 'react';

import { Nav } from './components/nav.js';
import { SectionRouter } from './components/section-router.js';
import { useAppStore } from './store/app-store.js';

export function App(): ReactElement {
    const setWorkflows = useAppStore((state) => state.setWorkflows);

    useEffect(() => {
        const unsubscribe = window.sigil.onWorkflowsList((workflows) => {
            setWorkflows(workflows);
        });
        return () => {
            unsubscribe();
        };
    }, [setWorkflows]);

    return (
        <div className="flex h-full">
            <Nav />
            <main className="flex-1 overflow-hidden">
                <SectionRouter />
            </main>
        </div>
    );
}
