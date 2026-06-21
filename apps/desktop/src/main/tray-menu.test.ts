import { describe, expect, it } from 'vitest';

import { buildTrayMenu } from './tray-menu.js';

describe('buildTrayMenu', () => {
    it('offers enabling workflows when they are inactive', () => {
        const menu = buildTrayMenu(false);

        expect(menu.workflowsActive).toBe(false);
        expect(menu.items[0]).toEqual({ kind: 'enable-workflows' });
    });

    it('offers disabling workflows when they are active', () => {
        const menu = buildTrayMenu(true);

        expect(menu.workflowsActive).toBe(true);
        expect(menu.items[0]).toEqual({ kind: 'disable-workflows' });
    });

    it('always includes open-app and quit actions separated from the toggle', () => {
        const menu = buildTrayMenu(false);
        const kinds = menu.items.map((item) => item.kind);

        expect(kinds).toContain('open-app');
        expect(kinds).toContain('quit');
        expect(kinds).toContain('separator');
    });

    it('places a separator between the workflow toggle and the app actions', () => {
        const inactive = buildTrayMenu(false);
        const active = buildTrayMenu(true);

        const inactiveKinds = inactive.items.map((item) => item.kind);
        const activeKinds = active.items.map((item) => item.kind);

        expect(inactiveKinds).toEqual([
            'enable-workflows',
            'separator',
            'open-app',
            'separator',
            'quit',
        ]);
        expect(activeKinds).toEqual([
            'disable-workflows',
            'separator',
            'open-app',
            'separator',
            'quit',
        ]);
    });
});
