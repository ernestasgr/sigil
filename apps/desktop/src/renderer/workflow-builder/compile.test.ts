import { describe, expect, it } from 'vitest';

import { compileGraph } from './compile.js';

describe('compileGraph', () => {
    it('rejects an empty graph with a structured topology diagnostic', () => {
        const result = compileGraph([], [], { id: 'pipeline-1', workflowId: 'workflow-1' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'empty_pipeline',
                        target: { kind: 'pipeline' },
                    }),
                ]),
            );
        }
    });

    it('compiles a manual-trigger -> log graph with an out port edge', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'hi' } } },
        ];
        const edges = [{ id: 'e1', source: 'trigger', target: 'log', sourceHandle: 'out' }];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.nodes).toHaveLength(2);
            expect(result.value.edges).toEqual([
                { id: 'e1', source: 'trigger', target: 'log', sourcePort: 'out' },
            ]);
            expect(result.executable.triggerId).toBe('trigger');
        }
    });

    it('maps the sourceHandle to sourcePort for an if-else true branch', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
            {
                id: 'branch',
                data: {
                    type: 'if-else',
                    config: {
                        condition: {
                            target: 'payload',
                            field: 'ext',
                            operator: 'equals',
                            value: 'pdf',
                        },
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'x' } } },
        ];
        const edges = [
            { id: 'e0', source: 'trigger', target: 'branch', sourceHandle: 'out' },
            { id: 'e1', source: 'branch', target: 'log', sourceHandle: 'true' },
        ];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges[1].sourcePort).toBe('true');
        }
    });

    it('returns a clear error when a config is invalid', () => {
        const nodes = [{ id: 'log', data: { type: 'log', config: { message: '' } } }];

        const result = compileGraph(nodes, [], { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/message/);
        }
    });

    it('returns a clear error when an edge uses an invalid source port', () => {
        const nodes = [
            { id: 'log', data: { type: 'log', config: { message: 'x' } } },
            { id: 'log2', data: { type: 'log', config: { message: 'y' } } },
        ];
        const edges = [{ id: 'e1', source: 'log', target: 'log2', sourceHandle: 'bogus' }];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/invalid sourcePort "bogus"/);
        }
    });

    it('drops edges with a null sourceHandle rather than failing to compile', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
        ];

        const result = compileGraph(
            nodes,
            [{ id: 'e1', source: 'trigger', target: 'trigger', sourceHandle: null }],
            { id: 'p', workflowId: 'w' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges).toEqual([]);
            expect(result.diagnostics).toEqual([
                expect.objectContaining({
                    severity: 'warning',
                    code: 'invalid_edge',
                    target: { kind: 'edge', edgeId: 'e1' },
                }),
            ]);
            expect(result.diagnostics[0]?.message).toMatch(/reconnect/i);
        }
    });
});
