import { useEffect, type ReactElement } from 'react';

import { Nav } from './components/nav.js';
import { SectionRouter } from './components/section-router.js';
import { useAppStore } from './store/app-store.js';

export function App(): ReactElement {
    const setWorkflowsActive = useAppStore((state) => state.setWorkflowsActive);

    useEffect(() => {
        const unsubscribe = window.sigil.onWorkflowsActive((active) => {
            setWorkflowsActive(active);
        });
        return () => {
            unsubscribe();
        };
    }, [setWorkflowsActive]);

    return (
        <div className="flex h-full">
            <Nav />
            <main className="flex-1 overflow-hidden">
                <SectionRouter />
            </main>
        </div>
    );
}
