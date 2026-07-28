import { parseWorkflowDocument, type WorkflowDocument } from '@sigil/contracts';
import { FileEventNameSchema } from '@sigil/contracts/events';
import {
    NodeOutputPortIdSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import type { PipelineEdge, PipelineNode } from '@sigil/contracts/workflow';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateWorkflowTopology } from './topology.js';

const PROPERTY_OPTIONS = {
    numRuns: 100,
    verbose: true,
};

const trigger = (id: string): PipelineNode => ({
    id: PipelineNodeIdSchema.parse(id),
    type: 'manual-trigger',
    config: {
        eventName: FileEventNameSchema.parse('file.created'),
        payload: { path: '/tmp/file.txt', name: 'file.txt', ext: 'txt', size: 1, dir: '/tmp' },
    },
});

const log = (id: string): PipelineNode => ({
    id: PipelineNodeIdSchema.parse(id),
    type: 'log',
    config: { message: id },
});

const edge = (id: string, source: string, target: string, sourcePort = 'out'): PipelineEdge => ({
    id: PipelineEdgeIdSchema.parse(id),
    source: PipelineNodeIdSchema.parse(source),
    target: PipelineNodeIdSchema.parse(target),
    sourcePort: NodeOutputPortIdSchema.parse(sourcePort),
});

function pipeline(
    nodes: readonly PipelineNode[],
    edges: readonly PipelineEdge[],
): WorkflowDocument {
    return {
        id: 'pipeline-property',
        workflowId: WorkflowIdSchema.parse('workflow-property'),
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

const cycleWithTailPipelineArbitrary = fc
    .record({
        cycleLength: fc.integer({ min: 2, max: 6 }),
        tailLength: fc.integer({ min: 1, max: 5 }),
    })
    .map(({ cycleLength, tailLength }) => {
        const cycleNodes = Array.from({ length: cycleLength }, (_, index) => `cycle-${index}`);
        const tailNodes = Array.from({ length: tailLength }, (_, index) => `tail-${index}`);
        const nodes: PipelineNode[] = [
            trigger('trigger'),
            ...cycleNodes.map((nodeId) => log(nodeId)),
            ...tailNodes.map((nodeId) => log(nodeId)),
        ];
        const edges: PipelineEdge[] = [edge('trigger-cycle', 'trigger', cycleNodes[0] ?? '')];

        cycleNodes.forEach((nodeId, index) => {
            edges.push(
                edge(
                    `cycle-${index}`,
                    nodeId,
                    cycleNodes[(index + 1) % cycleNodes.length] ?? nodeId,
                ),
            );
        });

        edges.push(edge('cycle-tail', cycleNodes[cycleNodes.length - 1] ?? '', tailNodes[0] ?? ''));
        tailNodes.forEach((nodeId, index) => {
            const nextNodeId = tailNodes[index + 1];
            if (nextNodeId) edges.push(edge(`tail-${index}`, nodeId, nextNodeId));
        });

        return {
            pipeline: pipeline(nodes, edges),
            cycleEdgeIds: cycleNodes.map((_, index) => `cycle-${index}`),
        };
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
                            expect.objectContaining({
                                code: 'cycle',
                                target: expect.objectContaining({
                                    kind: 'edge',
                                    edgeId: 'edge-cycle',
                                }),
                            }),
                        ]),
                    );
                }
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('reports only strongly connected component Edges when a cycle has a downstream tail', () => {
        fc.assert(
            fc.property(
                cycleWithTailPipelineArbitrary,
                ({ pipeline: generatedPipeline, cycleEdgeIds }) => {
                    const first = validateWorkflowTopology(generatedPipeline);
                    const second = validateWorkflowTopology(generatedPipeline);

                    expect(first.ok).toBe(false);
                    expect(second).toEqual(first);
                    if (!first.ok) {
                        expect(
                            first.diagnostics
                                .filter((diagnostic) => diagnostic.code === 'cycle')
                                .flatMap((diagnostic) =>
                                    diagnostic.target.kind === 'edge'
                                        ? [diagnostic.target.edgeId]
                                        : [],
                                ),
                        ).toEqual(cycleEdgeIds);
                        expect(first.diagnostics).not.toEqual(
                            expect.arrayContaining([
                                expect.objectContaining({
                                    code: 'cycle',
                                    target: { kind: 'edge', edgeId: 'cycle-tail' },
                                }),
                            ]),
                        );
                    }
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated missing references and invalid ports during topology admission', () => {
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
                    const result = parseWorkflowDocument(malformedPipeline);

                    expect(result.ok).toBe(true);
                    if (result.ok) {
                        const topology = validateWorkflowTopology(result.value);
                        expect(topology.ok).toBe(false);
                        if (!topology.ok) {
                            expect(topology.diagnostics).toEqual(
                                expect.arrayContaining([
                                    expect.objectContaining({
                                        code:
                                            malformedKind === 'missing-reference'
                                                ? 'invalid_edge'
                                                : 'invalid_output_port',
                                    }),
                                ]),
                            );
                        }
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
                const result = parseWorkflowDocument(encoded);

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
