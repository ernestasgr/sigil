import { describe, expect, it } from 'vitest';

import { anyEnabled, toggleWorkflow, type WorkflowRegistryState } from './workflow-registry.js';

const sortWorkflows = (workflows: WorkflowRegistryState): WorkflowRegistryState =>
    [...workflows].sort((a, b) => a.id.localeCompare(b.id));

describe('toggleWorkflow', () => {
    it('enables a disabled workflow', () => {
        const state: WorkflowRegistryState = [
            { id: 'sort-downloads', name: 'Sort Downloads', enabled: false },
        ];

        const next = sortWorkflows(toggleWorkflow(state, 'sort-downloads'));

        expect(next).toEqual([{ id: 'sort-downloads', name: 'Sort Downloads', enabled: true }]);
    });

    it('disables an enabled workflow', () => {
        const state: WorkflowRegistryState = [
            { id: 'sort-downloads', name: 'Sort Downloads', enabled: true },
        ];

        const next = sortWorkflows(toggleWorkflow(state, 'sort-downloads'));

        expect(next).toEqual([{ id: 'sort-downloads', name: 'Sort Downloads', enabled: false }]);
    });

    it('leaves other workflows unchanged', () => {
        const state: WorkflowRegistryState = [
            { id: 'sort-downloads', name: 'Sort Downloads', enabled: true },
            { id: 'notify-build', name: 'Notify Build', enabled: false },
        ];

        const next = sortWorkflows(toggleWorkflow(state, 'sort-downloads'));

        expect(next).toEqual([
            { id: 'notify-build', name: 'Notify Build', enabled: false },
            { id: 'sort-downloads', name: 'Sort Downloads', enabled: false },
        ]);
    });

    it('returns the same state when the workflow id is unknown', () => {
        const state: WorkflowRegistryState = [
            { id: 'sort-downloads', name: 'Sort Downloads', enabled: false },
        ];

        const next = toggleWorkflow(state, 'nonexistent');

        expect(next).toBe(state);
    });
});

describe('anyEnabled', () => {
    it('returns false when the registry is empty', () => {
        expect(anyEnabled([])).toBe(false);
    });

    it('returns false when no workflow is enabled', () => {
        const state: WorkflowRegistryState = [
            { id: 'a', name: 'A', enabled: false },
            { id: 'b', name: 'B', enabled: false },
        ];

        expect(anyEnabled(state)).toBe(false);
    });

    it('returns true when at least one workflow is enabled', () => {
        const state: WorkflowRegistryState = [
            { id: 'a', name: 'A', enabled: false },
            { id: 'b', name: 'B', enabled: true },
        ];

        expect(anyEnabled(state)).toBe(true);
    });
});
