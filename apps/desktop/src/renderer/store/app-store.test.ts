import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowSummary } from '../../shared/workflow.js';

import { useAppStore } from './app-store.js';

const workflow = (id: string, name: string, enabled: boolean): WorkflowSummary => ({
    id,
    name,
    enabled,
});

describe('useAppStore', () => {
    beforeEach(() => {
        useAppStore.setState({
            activeSection: 'home',
            workflows: [],
            logs: [],
        });
    });

    it('boots to the Home section with an empty workflow list', () => {
        const state = useAppStore.getState();

        expect(state.activeSection).toBe('home');
        expect(state.workflows).toEqual([]);
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

    it('adopts the workflow list reported by the engine', () => {
        const list: readonly WorkflowSummary[] = [
            workflow('sort-downloads', 'Sort Downloads', true),
            workflow('notify-build', 'Notify Build', false),
        ];

        useAppStore.getState().setWorkflows(list);

        expect(useAppStore.getState().workflows).toEqual(list);
    });

    it('replaces the workflow list on each update rather than merging', () => {
        useAppStore.getState().setWorkflows([workflow('a', 'A', false)]);
        useAppStore.getState().setWorkflows([workflow('b', 'B', true)]);

        expect(useAppStore.getState().workflows).toEqual([workflow('b', 'B', true)]);
    });

    it('appends engine log lines to the log list', () => {
        useAppStore.getState().appendLog('first');
        useAppStore.getState().appendLog('second');

        expect(useAppStore.getState().logs.map((l) => l.line)).toEqual(['first', 'second']);
    });

    it('caps the log list at 200 entries', () => {
        for (let i = 0; i < 210; i++) {
            useAppStore.getState().appendLog(`line-${i}`);
        }

        const logs = useAppStore.getState().logs;
        expect(logs.length).toBe(200);
        expect(logs[0].line).toBe('line-10');
        expect(logs[199].line).toBe('line-209');
    });
});
