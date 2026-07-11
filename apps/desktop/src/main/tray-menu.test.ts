import { describe, expect, it } from 'vitest';

import type { WorkflowSummary } from '../shared/workflow.js';

import { buildTrayMenu } from './tray-menu.js';

const workflow = (id: string, name: string, enabled: boolean): WorkflowSummary => ({
    id,
    name,
    enabled,
    activation: enabled ? { kind: 'active' } : { kind: 'disabled' },
});

describe('buildTrayMenu', () => {
    it('lists each workflow as a toggle item', () => {
        const workflows: readonly WorkflowSummary[] = [
            workflow('sort-downloads', 'Sort Downloads', true),
            workflow('notify-build', 'Notify Build', false),
        ];

        const menu = buildTrayMenu(workflows);

        expect(menu.items[0]).toEqual({
            kind: 'workflow-toggle',
            workflow: workflow('sort-downloads', 'Sort Downloads', true),
        });
        expect(menu.items[1]).toEqual({
            kind: 'workflow-toggle',
            workflow: workflow('notify-build', 'Notify Build', false),
        });
    });

    it('shows a no-workflows placeholder when the registry is empty', () => {
        const menu = buildTrayMenu([]);

        expect(menu.items[0]).toEqual({ kind: 'no-workflows' });
    });

    it('always includes open-app and quit actions separated from the workflow list', () => {
        const menu = buildTrayMenu([workflow('a', 'A', false)]);
        const kinds = menu.items.map((item) => item.kind);

        expect(kinds).toContain('open-app');
        expect(kinds).toContain('quit');
        expect(kinds).toContain('separator');
    });

    it('places a separator between the workflow list and the app actions', () => {
        const menu = buildTrayMenu([workflow('a', 'A', false)]);

        const kinds = menu.items.map((item) => item.kind);

        expect(kinds).toEqual(['workflow-toggle', 'separator', 'open-app', 'separator', 'quit']);
    });

    it('places a separator between the no-workflows label and the app actions when empty', () => {
        const menu = buildTrayMenu([]);

        const kinds = menu.items.map((item) => item.kind);

        expect(kinds).toEqual(['no-workflows', 'separator', 'open-app', 'separator', 'quit']);
    });

    it('reports workflows active when at least one workflow is enabled', () => {
        const menu = buildTrayMenu([workflow('a', 'A', false), workflow('b', 'B', true)]);

        expect(menu.workflowsActive).toBe(true);
    });

    it('reports workflows inactive when no workflow is enabled', () => {
        const menu = buildTrayMenu([workflow('a', 'A', false)]);

        expect(menu.workflowsActive).toBe(false);
    });

    it('reports workflows inactive when the registry is empty', () => {
        const menu = buildTrayMenu([]);

        expect(menu.workflowsActive).toBe(false);
    });

    it('reports workflows inactive when enabled intent has failed activation', () => {
        const menu = buildTrayMenu([
            {
                id: 'broken',
                name: 'Broken Workflow',
                enabled: true,
                activation: { kind: 'failed', message: 'worker unavailable' },
            },
        ]);

        expect(menu.workflowsActive).toBe(false);
        expect(menu.items[0]).toMatchObject({
            kind: 'workflow-toggle',
            workflow: { enabled: true, activation: { kind: 'failed' } },
        });
    });
});
