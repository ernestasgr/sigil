import { parsePipeline } from '@sigil/schema';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compileGraph, type VisualEdge, type VisualNode } from './compile.js';

const PROPERTY_OPTIONS = {
    numRuns: 100,
    verbose: true,
};

const meta = { id: 'pipeline-property', workflowId: 'workflow-property' } as const;

const trigger = (id: string): VisualNode => ({
    id,
    data: {
        type: 'manual-trigger',
        config: {
            eventName: 'file.created',
            payload: { path: '/tmp/file.txt', name: 'file.txt', ext: 'txt', size: 1, dir: '/tmp' },
        },
    },
});

const log = (id: string): VisualNode => ({
    id,
    data: { type: 'log', config: { message: id } },
});

const edge = (id: string, source: string, target: string, sourceHandle = 'out'): VisualEdge => ({
    id,
    source,
    target,
    sourceHandle,
});

interface VisualGraph {
    readonly nodes: readonly VisualNode[];
    readonly edges: readonly VisualEdge[];
}

const visualDagArbitrary = fc
    .array(fc.nat({ max: 9 }), { minLength: 0, maxLength: 8 })
    .map((parentSeeds): VisualGraph => {
        const nodes: VisualNode[] = [trigger('node-0')];
        const edges: VisualEdge[] = [];

        parentSeeds.forEach((seed, index) => {
            const nodeId = `node-${index + 1}`;
            const sourceIndex = index < 2 ? 0 : seed % (index + 1);
            nodes.push(log(nodeId));
            edges.push(edge(`edge-${index}`, `node-${sourceIndex}`, nodeId));
        });

        return { nodes, edges };
    });

const nonTrivialVisualDagArbitrary = fc
    .array(fc.nat({ max: 9 }), { minLength: 1, maxLength: 8 })
    .map((parentSeeds): VisualGraph => {
        const nodes: VisualNode[] = [trigger('node-0')];
        const edges: VisualEdge[] = [];

        parentSeeds.forEach((seed, index) => {
            const nodeId = `node-${index + 1}`;
            const sourceIndex = index < 2 ? 0 : seed % (index + 1);
            nodes.push(log(nodeId));
            edges.push(edge(`edge-${index}`, `node-${sourceIndex}`, nodeId));
        });

        return { nodes, edges };
    });

describe('generated compileGraph properties', () => {
    it('compiles valid visual DAGs without losing identity, ports, or deterministic order', () => {
        fc.assert(
            fc.property(visualDagArbitrary, (graph) => {
                const result = compileGraph(graph.nodes, graph.edges, meta);

                expect(result.ok).toBe(true);
                if (!result.ok) return;

                expect(result.value.id).toBe(meta.id);
                expect(result.value.workflowId).toBe(meta.workflowId);
                expect(result.value.nodes.map((node) => node.id)).toEqual(
                    graph.nodes.map((node) => node.id),
                );
                expect(result.value.edges).toEqual(
                    graph.edges.map((currentEdge) => ({
                        id: currentEdge.id,
                        source: currentEdge.source,
                        target: currentEdge.target,
                        sourcePort: currentEdge.sourceHandle,
                    })),
                );
                expect(result.executable.triggerId).toBe('node-0');
                expect(result.executable.executionOrder).toHaveLength(graph.nodes.length);
                expect(new Set(result.executable.executionOrder).size).toBe(graph.nodes.length);

                const second = compileGraph(graph.nodes, graph.edges, meta);
                expect(second).toEqual(result);

                const roundTrip = parsePipeline(JSON.parse(JSON.stringify(result.value)));
                expect(roundTrip).toEqual({ ok: true, value: result.value });
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated malformed references and ports before execution', () => {
        fc.assert(
            fc.property(
                nonTrivialVisualDagArbitrary,
                fc.constantFrom('missing-source', 'missing-target', 'invalid-port'),
                (graph, malformedKind) => {
                    const malformedGraph = {
                        nodes: graph.nodes,
                        edges: graph.edges.map((currentEdge, index) => {
                            if (index !== 0) return currentEdge;
                            if (malformedKind === 'missing-source') {
                                return { ...currentEdge, source: 'ghost-source' };
                            }
                            if (malformedKind === 'missing-target') {
                                return { ...currentEdge, target: 'ghost-target' };
                            }
                            return { ...currentEdge, sourceHandle: 'missing-port' };
                        }),
                    };
                    const result = compileGraph(malformedGraph.nodes, malformedGraph.edges, meta);

                    expect(result.ok).toBe(false);
                    if (!result.ok) {
                        expect(result.diagnostics).toEqual(
                            expect.arrayContaining([
                                expect.objectContaining({ code: 'invalid_pipeline' }),
                            ]),
                        );
                        expect(result.error).toMatch(
                            malformedKind === 'invalid-port'
                                ? /invalid sourcePort "missing-port"/
                                : /unknown (source|target) node/,
                        );
                    }
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated cycles while preserving the cycle Edge identity in diagnostics', () => {
        fc.assert(
            fc.property(nonTrivialVisualDagArbitrary, (graph) => {
                const lastNode = graph.nodes[graph.nodes.length - 1];
                if (!lastNode) return;

                const result = compileGraph(
                    graph.nodes,
                    [...graph.edges, edge('edge-cycle', lastNode.id, lastNode.id)],
                    meta,
                );

                expect(result.ok).toBe(false);
                if (!result.ok) {
                    expect(result.diagnostics).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ code: 'cycle', edgeId: 'edge-cycle' }),
                        ]),
                    );
                }
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('keeps a generated detached edge recoverable as a warning when its source handle is absent', () => {
        fc.assert(
            fc.property(nonTrivialVisualDagArbitrary, (graph) => {
                const firstEdge = graph.edges[0];
                if (!firstEdge) return;

                const result = compileGraph(
                    graph.nodes,
                    [...graph.edges, { ...firstEdge, id: 'edge-detached', sourceHandle: null }],
                    meta,
                );

                expect(result.ok).toBe(true);
                if (result.ok) {
                    expect(result.value.edges).toHaveLength(graph.edges.length);
                    expect(result.diagnostics).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                severity: 'warning',
                                code: 'invalid_edge',
                                edgeId: 'edge-detached',
                            }),
                        ]),
                    );
                }
            }),
            PROPERTY_OPTIONS,
        );
    });
});
