import { beforeEach, describe, expect, it } from 'vitest';

import { useAppStore } from './app-store.js';

describe('useAppStore', () => {
    beforeEach(() => {
        useAppStore.setState({
            activeSection: 'home',
            workflowsActive: false,
        });
    });

    it('boots to the Home section with workflows inactive', () => {
        const state = useAppStore.getState();

        expect(state.activeSection).toBe('home');
        expect(state.workflowsActive).toBe(false);
    });

    it('navigates to a different section', () => {
        useAppStore.getState().navigate('workflows');

        expect(useAppStore.getState().activeSection).toBe('workflows');
    });

    it('can navigate to every section in the navigation surface', () => {
        const sections = ['workflows', 'events', 'plugins', 'settings', 'home'] as const;

        for (const section of sections) {
            useAppStore.getState().navigate(section);
            expect(useAppStore.getState().activeSection).toBe(section);
        }
    });

    it('reflects workflow active state reported by the engine', () => {
        useAppStore.getState().setWorkflowsActive(true);

        expect(useAppStore.getState().workflowsActive).toBe(true);
    });
});
