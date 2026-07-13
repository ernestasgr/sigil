import { describe, expect, it } from 'vitest';

import { nextPaletteNodePosition, resolveWorkflowPositions } from './layout.js';

describe('workflow layout fallback', () => {
    it('places missing positions by deterministic topology depth and row', () => {
        const nodes = [{ id: 'trigger' }, { id: 'log' }, { id: 'delay' }];
        const edges = [
            { source: 'trigger', target: 'log' },
            { source: 'log', target: 'delay' },
        ];

        const first = resolveWorkflowPositions(nodes, edges);
        const second = resolveWorkflowPositions(nodes, edges);

        expect(first).toEqual(second);
        expect(first.trigger).toEqual({ x: 40, y: 40 });
        expect(first.log?.x).toBeGreaterThan(first.trigger?.x ?? 0);
        expect(first.delay?.x).toBeGreaterThan(first.log?.x ?? 0);
        expect(
            new Set(Object.values(first).map((position) => `${position.x}:${position.y}`)).size,
        ).toBe(nodes.length);
    });

    it('preserves valid saved positions and fills partial or invalid positions', () => {
        const positions = resolveWorkflowPositions(
            [{ id: 'trigger' }, { id: 'log' }, { id: 'delay' }],
            [{ source: 'trigger', target: 'log' }],
            {
                trigger: { x: 600, y: 80 },
                log: { x: Number.NaN, y: 0 },
            },
        );

        expect(positions.trigger).toEqual({ x: 600, y: 80 });
        expect(positions.log).not.toEqual({ x: 0, y: 0 });
        expect(positions.delay).not.toEqual({ x: 0, y: 0 });
        expect(
            new Set(Object.values(positions).map((position) => `${position.x}:${position.y}`)).size,
        ).toBe(3);
    });
});

describe('keyboard palette layout', () => {
    it('returns the next unoccupied grid position', () => {
        const position = nextPaletteNodePosition([
            { position: { x: 40, y: 40 } },
            { position: { x: 320, y: 40 } },
        ]);

        expect(position).toEqual({ x: 600, y: 40 });
    });
});
