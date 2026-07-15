import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PipelineEdge } from './edges.js';
import type { PipelineNode } from './nodes/index.js';
import { type CompiledPipeline, parsePipeline } from './pipeline.js';
import { validateWorkflowTopology } from './topology.js';

const PROPERTY_OPTIONS = {
    numRuns: 100,
    verbose: true,
};

const trigger = (id: string): PipelineNode => ({
    id,
    type: 'manual-trigger',
    config: {
        eventName: 'file.created',
        payload: { path: '/tmp/file.txt', name: 'file.txt', ext: 'txt', size: 1, dir: '/tmp' },
    },
});

const log = (id: string): PipelineNode => ({
    id,
    type: 'log',
    config: { message: id },
});

const edge = (id: string, source: string, target: string, sourcePort = 'out'): PipelineEdge => ({
    id,
    source,
    target,
    sourcePort,
});

function pipeline(
    nodes: readonly PipelineNode[],
    edges: readonly PipelineEdge[],
): CompiledPipeline {
    return {
        id: 'pipeline-property',
        workflowId: 'workflow-property',
        schemaVersion: 1,
        nodes: [...nodes],
        edges: [...edges],
    };
}

/**
 * Each generated Node has exactly one parent with a lower index. The first
 * two children share the Trigger, so graphs with at least three Nodes are
 * guaranteed to exercise fan-out while remaining acyclic and join-free.
 */
const dagPipelineArbitrary = fc
    .array(fc.nat({ max: 9 }), { minLength: 0, maxLength: 8 })
    .map((parentSeeds) => {
        const nodes: PipelineNode[] = [trigger('node-0')];
        const edges: PipelineEdge[] = [];

        parentSeeds.forEach((seed, index) => {
            const nodeId = `node-${index + 1}`;
            const sourceIndex = index < 2 ? 0 : seed % (index + 1);
            nodes.push(log(nodeId));
            edges.push(edge(`edge-${index}`, `node-${sourceIndex}`, nodeId));
        });

        return pipeline(nodes, edges);
    });

const nonTrivialDagPipelineArbitrary = fc
    .array(fc.nat({ max: 9 }), { minLength: 1, maxLength: 8 })
    .map((parentSeeds) => {
        const nodes: PipelineNode[] = [trigger('node-0')];
        const edges: PipelineEdge[] = [];

        parentSeeds.forEach((seed, index) => {
            const nodeId = `node-${index + 1}`;
            const sourceIndex = index < 2 ? 0 : seed % (index + 1);
            nodes.push(log(nodeId));
            edges.push(edge(`edge-${index}`, `node-${sourceIndex}`, nodeId));
        });

        return pipeline(nodes, edges);
    });

function diagnosticCodes(result: ReturnType<typeof validateWorkflowTopology>): readonly string[] {
    return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('generated Workflow topology properties', () => {
    it('accepts valid DAGs, including generated branching graphs, with a deterministic permutation', () => {
        fc.assert(
            fc.property(dagPipelineArbitrary, (generatedPipeline) => {
                const first = validateWorkflowTopology(generatedPipeline);
                expect(first.ok).toBe(true);
                if (!first.ok) return;

                const second = validateWorkflowTopology(generatedPipeline);
                expect(second).toEqual(first);
                expect(first.value.triggerId).toBe('node-0');
                expect(first.value.executionOrder).toHaveLength(generatedPipeline.nodes.length);
                expect(new Set(first.value.executionOrder).size).toBe(
                    generatedPipeline.nodes.length,
                );
                expect(first.value.executionOrder).toEqual(
                    expect.arrayContaining(generatedPipeline.nodes.map((node) => node.id)),
                );
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('handles empty and single-Node boundary graphs explicitly', () => {
        const boundaryArbitrary = fc.constantFrom(
            pipeline([], []),
            pipeline([trigger('node-0')], []),
        );

        fc.assert(
            fc.property(boundaryArbitrary, (generatedPipeline) => {
                const result = validateWorkflowTopology(generatedPipeline);
                if (generatedPipeline.nodes.length === 0) {
                    expect(result.ok).toBe(false);
                    expect(diagnosticCodes(result)).toContain('empty_pipeline');
                    return;
                }

                expect(result.ok).toBe(true);
                if (result.ok) {
                    expect(result.value.executionOrder).toEqual(['node-0']);
                }
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated cycles and identifies the malformed Edge', () => {
        fc.assert(
            fc.property(nonTrivialDagPipelineArbitrary, (generatedPipeline) => {
                const lastNode = generatedPipeline.nodes[generatedPipeline.nodes.length - 1];
                if (!lastNode) return;

                const cyclicPipeline = {
                    ...generatedPipeline,
                    edges: [
                        ...generatedPipeline.edges,
                        edge('edge-cycle', lastNode.id, lastNode.id),
                    ],
                };
                const result = validateWorkflowTopology(cyclicPipeline);

                expect(result.ok).toBe(false);
                expect(diagnosticCodes(result)).toContain('cycle');
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

    it('rejects generated missing references and invalid ports at the schema boundary', () => {
        fc.assert(
            fc.property(
                nonTrivialDagPipelineArbitrary,
                fc.constantFrom('missing-reference', 'invalid-port'),
                (generatedPipeline, malformedKind) => {
                    const malformedPipeline =
                        malformedKind === 'missing-reference'
                            ? {
                                  ...generatedPipeline,
                                  edges: [
                                      ...generatedPipeline.edges,
                                      edge('edge-missing', 'ghost-node', 'node-1'),
                                  ],
                              }
                            : {
                                  ...generatedPipeline,
                                  edges: generatedPipeline.edges.map((currentEdge, index) =>
                                      index === 0
                                          ? { ...currentEdge, sourcePort: 'missing-port' }
                                          : currentEdge,
                                  ),
                              };
                    const result = parsePipeline(malformedPipeline);

                    expect(result.ok).toBe(false);
                    if (!result.ok) {
                        expect(result.error).toMatch(
                            malformedKind === 'missing-reference'
                                ? /unknown source node/
                                : /invalid sourcePort "missing-port"/,
                        );
                    }
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('preserves pipeline metadata, Node identity, Edge identity, and ports through JSON round trips', () => {
        fc.assert(
            fc.property(dagPipelineArbitrary, (generatedPipeline) => {
                const encoded: unknown = JSON.parse(JSON.stringify(generatedPipeline));
                const result = parsePipeline(encoded);

                expect(result.ok).toBe(true);
                if (!result.ok) return;

                expect(result.value.id).toBe(generatedPipeline.id);
                expect(result.value.workflowId).toBe(generatedPipeline.workflowId);
                expect(result.value.schemaVersion).toBe(generatedPipeline.schemaVersion);
                expect(result.value.nodes.map((node) => node.id)).toEqual(
                    generatedPipeline.nodes.map((node) => node.id),
                );
                expect(result.value.edges).toEqual(generatedPipeline.edges);
            }),
            PROPERTY_OPTIONS,
        );
    });
});

describe('topology regression examples', () => {
    it.each([
        {
            name: 'empty Pipeline',
            graph: pipeline([], []),
            code: 'empty_pipeline',
        },
        {
            name: 'self-loop Edge',
            graph: pipeline(
                [trigger('trigger'), log('log')],
                [edge('trigger-log', 'trigger', 'log'), edge('cycle', 'log', 'log')],
            ),
            code: 'cycle',
        },
        {
            name: 'implicit join',
            graph: pipeline(
                [trigger('trigger'), log('left'), log('right'), log('joined')],
                [
                    edge('trigger-left', 'trigger', 'left'),
                    edge('trigger-right', 'trigger', 'right'),
                    edge('left-joined', 'left', 'joined'),
                    edge('right-joined', 'right', 'joined'),
                ],
            ),
            code: 'implicit_join',
        },
    ])('keeps the focused $name regression example', ({ graph, code }) => {
        const result = validateWorkflowTopology(graph);

        expect(result.ok).toBe(false);
        expect(diagnosticCodes(result)).toContain(code);
    });
});
