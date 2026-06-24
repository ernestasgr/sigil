import { describe, expect, it } from 'vitest';

import { compileGraph } from './compile.js';

describe('compileGraph', () => {
    it('compiles an empty graph into a valid empty pipeline', () => {
        const result = compileGraph([], [], { id: 'pipeline-1', workflowId: 'workflow-1' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.nodes).toEqual([]);
            expect(result.value.edges).toEqual([]);
            expect(result.value.schemaVersion).toBe(1);
            expect(result.value.id).toBe('pipeline-1');
            expect(result.value.workflowId).toBe('workflow-1');
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
        }
    });

    it('maps the sourceHandle to sourcePort for an if-else true branch', () => {
        const nodes = [
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
        const edges = [{ id: 'e1', source: 'branch', target: 'log', sourceHandle: 'true' }];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges[0].sourcePort).toBe('true');
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
        const nodes = [{ id: 'log', data: { type: 'log', config: { message: 'x' } } }];

        const result = compileGraph(
            nodes,
            [{ id: 'e1', source: 'log', target: 'log', sourceHandle: null }],
            { id: 'p', workflowId: 'w' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges).toEqual([]);
        }
    });
});
