import type { WorkflowDocument } from '@sigil/contracts';

import type { PipelineEdge } from '@sigil/contracts/edges';
import { FileEventNameSchema } from '@sigil/contracts/event-catalog';
import {
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    PluginIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import type { PipelineNode } from '@sigil/contracts/nodes';
import { SwitchCaseIdSchema } from '@sigil/contracts/nodes/switch';
import { describe, expect, it } from 'vitest';
import { pluginNodeIdentity, registerSerializableNodeContract } from './node-contract.js';
import { createBuiltinNodeContractRegistry } from './nodes/catalog.js';
import { switchOutputPortSpec } from './nodes/switch.js';
import {
    formatTopologyDiagnostics,
    formatTopologyDiagnosticTarget,
    TopologyDiagnosticCodeSchema,
    TopologyDiagnosticSchema,
    topologyDiagnosticKey,
    validateWorkflowTopology,
} from './topology.js';

const pid = (id: string) => PluginIdSchema.parse(id);
const nt = (type: string) => NodeTypeNameSchema.parse(type);
const ANY_CONFIG_SCHEMA = {
    version: 1,
    dialect: 'https://json-schema.org/draft/2020-12/schema',
    schema: {},
} as const;

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
        id: 'pipeline-1',
        workflowId: WorkflowIdSchema.parse('workflow-1'),
        schemaVersion: 1,
        nodes: [...nodes],
        edges: [...edges],
    };
}

function diagnosticCodes(result: ReturnType<typeof validateWorkflowTopology>): readonly string[] {
    return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

function cycleDiagnosticEdgeIds(
    result: ReturnType<typeof validateWorkflowTopology>,
): readonly string[] {
    if (result.ok) return [];
    return result.diagnostics.flatMap((diagnostic) => {
        if (diagnostic.code !== 'cycle' || diagnostic.target.kind !== 'edge') return [];
        return [diagnostic.target.edgeId];
    });
}

const cycleDiagnosticCases = [
    {
        name: 'a multi-Node cycle with a downstream tail',
        createGraph: (): WorkflowDocument =>
            pipeline(
                [trigger('trigger'), log('a'), log('b'), log('tail')],
                [
                    edge('trigger-a', 'trigger', 'a'),
                    edge('a-b', 'a', 'b'),
                    edge('b-a', 'b', 'a'),
                    edge('b-tail', 'b', 'tail'),
                ],
            ),
        cycleEdgeIds: ['a-b', 'b-a'],
    },
    {
        name: 'a self-loop with a downstream tail',
        createGraph: (): WorkflowDocument =>
            pipeline(
                [trigger('trigger'), log('loop'), log('tail')],
                [
                    edge('trigger-loop', 'trigger', 'loop'),
                    edge('loop-self', 'loop', 'loop'),
                    edge('loop-tail', 'loop', 'tail'),
                ],
            ),
        cycleEdgeIds: ['loop-self'],
    },
    {
        name: 'multiple independent cycles with downstream tails',
        createGraph: (): WorkflowDocument =>
            pipeline(
                [
                    trigger('trigger'),
                    log('left-a'),
                    log('left-b'),
                    log('left-tail'),
                    log('right-a'),
                    log('right-b'),
                    log('right-tail'),
                ],
                [
                    edge('trigger-left', 'trigger', 'left-a'),
                    edge('left-a-b', 'left-a', 'left-b'),
                    edge('left-b-a', 'left-b', 'left-a'),
                    edge('left-b-tail', 'left-b', 'left-tail'),
                    edge('trigger-right', 'trigger', 'right-a'),
                    edge('right-a-b', 'right-a', 'right-b'),
                    edge('right-b-a', 'right-b', 'right-a'),
                    edge('right-b-tail', 'right-b', 'right-tail'),
                ],
            ),
        cycleEdgeIds: ['left-a-b', 'left-b-a', 'right-a-b', 'right-b-a'],
    },
] as const;

describe('validateWorkflowTopology', () => {
    it('accepts warning diagnostics as a first-class severity', () => {
        const result = TopologyDiagnosticSchema.safeParse({
            severity: 'warning',
            code: 'invalid_edge',
            target: { kind: 'edge', edgeId: 'edge-1' },
            message: 'Reconnect the Edge to a declared output port.',
        });

        expect(result.success).toBe(true);
    });

    it('accepts generic Node-owned diagnostic details without built-in knowledge', () => {
        const result = TopologyDiagnosticSchema.safeParse({
            severity: 'error',
            code: 'invalid_node_contract',
            target: { kind: 'node', nodeId: 'plugin-router' },
            details: {
                namespace: 'plugin.example.router',
                code: 'unsupported_target',
                data: { field: 'target', allowed: ['event', 'payload'] },
            },
            message: 'The router target is not supported.',
        });

        expect(result.success).toBe(true);
        expect(TopologyDiagnosticCodeSchema.safeParse('duplicate_match_value').success).toBe(false);
    });

    it('rejects contradictory target identity sidecars and unnamespaced Node codes', () => {
        expect(
            TopologyDiagnosticSchema.safeParse({
                severity: 'error',
                code: 'invalid_node_contract',
                target: { kind: 'node', nodeId: 'node-1' },
                nodeId: 'node-2',
                message: 'Contradictory Node identity.',
            }).success,
        ).toBe(false);
        expect(
            TopologyDiagnosticSchema.safeParse({
                severity: 'error',
                code: 'invalid_output_port',
                target: { kind: 'edge', edgeId: 'edge-1' },
                edgeId: 'edge-2',
                message: 'Contradictory Edge identity.',
            }).success,
        ).toBe(false);
        expect(
            TopologyDiagnosticSchema.safeParse({
                severity: 'error',
                code: 'duplicate_match_value',
                target: { kind: 'node', nodeId: 'node-1' },
                message: 'Switch-specific codes belong in Node details.',
            }).success,
        ).toBe(false);
    });

    it('derives display and deduplication identity from the target union', () => {
        const nodeDiagnostic = {
            severity: 'error',
            code: 'invalid_node_contract',
            target: { kind: 'node', nodeId: PipelineNodeIdSchema.parse('node-1') },
            details: { namespace: 'plugin.example', code: 'invalid_config' },
            message: 'Invalid configuration.',
        } as const;
        const sameTarget = { ...nodeDiagnostic, message: 'A different message.' } as const;
        const otherTarget = {
            ...nodeDiagnostic,
            target: { kind: 'node', nodeId: PipelineNodeIdSchema.parse('node-2') },
        } as const;

        expect(formatTopologyDiagnosticTarget(nodeDiagnostic.target)).toBe('Node node-1');
        expect(
            formatTopologyDiagnosticTarget({
                kind: 'edge',
                edgeId: PipelineEdgeIdSchema.parse('edge-1'),
                relatedNodeId: PipelineNodeIdSchema.parse('node-1'),
            }),
        ).toBe('Edge edge-1 · Node node-1');
        expect(topologyDiagnosticKey(nodeDiagnostic)).toBe(topologyDiagnosticKey(sameTarget));
        expect(topologyDiagnosticKey(nodeDiagnostic)).not.toBe(topologyDiagnosticKey(otherTarget));
        expect(
            topologyDiagnosticKey({
                ...nodeDiagnostic,
                target: {
                    kind: 'edge',
                    edgeId: PipelineEdgeIdSchema.parse('edge-1'),
                },
            }),
        ).not.toBe(
            topologyDiagnosticKey({
                ...nodeDiagnostic,
                target: {
                    kind: 'edge',
                    edgeId: PipelineEdgeIdSchema.parse('edge-1'),
                    relatedNodeId: PipelineNodeIdSchema.parse('node-1'),
                },
            }),
        );
    });

    it('rejects an empty Pipeline with a repair-oriented diagnostic', () => {
        const result = validateWorkflowTopology({
            id: 'pipeline-1',
            workflowId: WorkflowIdSchema.parse('workflow-1'),
            schemaVersion: 1,
            nodes: [],
            edges: [],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual([
                expect.objectContaining({
                    code: 'empty_pipeline',
                    target: { kind: 'pipeline' },
                }),
            ]);
            expect(result.diagnostics[0]?.message).toMatch(/add/i);
        }
    });

    it('accepts a Trigger-rooted fan-out and returns a stable execution order', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('first'), log('second')],
                [
                    edge('trigger-first', 'trigger', 'first'),
                    edge('trigger-second', 'trigger', 'second'),
                ],
            ),
        );

        expect(result).toEqual({
            ok: true,
            value: expect.objectContaining({
                triggerId: 'trigger',
                executionOrder: ['trigger', 'first', 'second'],
            }),
        });
    });

    it('rejects a Pipeline without a Trigger and identifies an unsupported root', () => {
        const result = validateWorkflowTopology(pipeline([log('log')], []));

        expect(diagnosticCodes(result)).toEqual(
            expect.arrayContaining(['missing_trigger', 'unsupported_root']),
        );
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unsupported_root',
                        target: { kind: 'node', nodeId: 'log' },
                    }),
                ]),
            );
        }
    });

    it('rejects multiple Trigger roots', () => {
        const result = validateWorkflowTopology(
            pipeline([trigger('first'), trigger('second')], []),
        );

        expect(diagnosticCodes(result)).toEqual(
            expect.arrayContaining(['multiple_triggers', 'multiple_roots']),
        );
    });

    it('reports a Trigger that has an incoming Edge instead of being the root', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('source')],
                [edge('source-trigger', 'source', 'trigger')],
            ),
        );

        expect(diagnosticCodes(result)).toContain('trigger_not_root');
    });

    it('rejects a cycle and identifies the participating Edge', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('a'), log('b')],
                [edge('trigger-a', 'trigger', 'a'), edge('a-b', 'a', 'b'), edge('b-a', 'b', 'a')],
            ),
        );

        expect(diagnosticCodes(result)).toContain('cycle');
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'cycle',
                        target: { kind: 'edge', edgeId: 'a-b', relatedNodeId: 'a' },
                    }),
                    expect.objectContaining({
                        code: 'cycle',
                        target: { kind: 'edge', edgeId: 'b-a', relatedNodeId: 'b' },
                    }),
                ]),
            );
        }
    });

    it.each(cycleDiagnosticCases)('targets only $name', ({ createGraph, cycleEdgeIds }) => {
        const graph = createGraph();
        const first = validateWorkflowTopology(graph);

        expect(first.ok).toBe(false);
        expect(cycleDiagnosticEdgeIds(first)).toEqual(cycleEdgeIds);

        if (!first.ok) {
            expect(first.diagnostics.filter((diagnostic) => diagnostic.code === 'cycle')).toEqual(
                cycleEdgeIds.map((edgeId) =>
                    expect.objectContaining({
                        code: 'cycle',
                        target: expect.objectContaining({ kind: 'edge', edgeId }),
                    }),
                ),
            );
        }

        expect(validateWorkflowTopology(graph)).toEqual(first);
    });

    it('rejects a disconnected Node', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('connected'), log('orphan')],
                [edge('e1', 'trigger', 'connected')],
            ),
        );

        expect(diagnosticCodes(result)).toEqual(
            expect.arrayContaining(['multiple_roots', 'disconnected_node']),
        );
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'disconnected_node',
                        target: { kind: 'node', nodeId: 'orphan' },
                    }),
                ]),
            );
        }
    });

    it('rejects an implicit join', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('left'), log('right'), log('joined')],
                [
                    edge('trigger-left', 'trigger', 'left'),
                    edge('trigger-right', 'trigger', 'right'),
                    edge('left-joined', 'left', 'joined'),
                    edge('right-joined', 'right', 'joined'),
                ],
            ),
        );

        expect(diagnosticCodes(result)).toContain('implicit_join');
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'implicit_join',
                        target: { kind: 'node', nodeId: 'joined' },
                    }),
                ]),
            );
        }
    });

    it('rejects an Edge that uses an undeclared output port', () => {
        const result = validateWorkflowTopology(
            pipeline([trigger('trigger'), log('log')], [edge('e1', 'trigger', 'log', 'bogus')]),
        );

        expect(diagnosticCodes(result)).toContain('invalid_output_port');
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'invalid_output_port',
                        target: { kind: 'edge', edgeId: 'e1', relatedNodeId: 'trigger' },
                    }),
                ]),
            );
        }
    });

    it('reports structured Switch match diagnostics at the offending case field', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [
                    trigger('trigger'),
                    {
                        id: PipelineNodeIdSchema.parse('switch'),
                        type: 'switch',
                        config: {
                            target: 'payload',
                            field: 'ext',
                            comparison: 'string',
                            cases: [
                                { id: SwitchCaseIdSchema.parse('pdf'), value: 'pdf' },
                                { id: SwitchCaseIdSchema.parse('duplicate'), value: 'PDF' },
                                { id: SwitchCaseIdSchema.parse('empty'), value: '' },
                                { id: SwitchCaseIdSchema.parse('reserved'), value: 'default' },
                                { id: SwitchCaseIdSchema.parse('invalid'), value: 'line\nbreak' },
                            ],
                        },
                    },
                ],
                [edge('trigger-switch', 'trigger', 'switch')],
            ),
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(diagnosticCodes(result)).toEqual(
                expect.arrayContaining(['invalid_node_contract']),
            );
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'invalid_node_contract',
                        target: { kind: 'node', nodeId: 'switch' },
                        details: {
                            namespace: 'builtin.switch',
                            code: 'duplicate_match_value',
                            data: expect.objectContaining({ caseId: 'duplicate' }),
                        },
                        fieldPath: 'config.cases[1].value',
                        repairHint: expect.any(String),
                    }),
                ]),
            );
        }
    });

    it('reports malformed built-in Switch configuration through the contract diagnostic seam', () => {
        const malformedSwitch = {
            id: 'switch',
            type: 'switch',
            config: { target: 'payload', field: '', cases: [] },
        } as unknown as PipelineNode;
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), malformedSwitch],
                [edge('trigger-switch', 'trigger', 'switch')],
            ),
        );

        expect(result).toMatchObject({
            ok: false,
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'invalid_node_contract',
                    target: { kind: 'node', nodeId: 'switch' },
                }),
            ]),
        });
    });

    it('allows a plugin Node to declare trigger and output-port capabilities', () => {
        const plugin: PipelineNode = {
            id: PipelineNodeIdSchema.parse('plugin-trigger'),
            type: nt('tick-trigger'),
            pluginId: pid('com.example.tick'),
            config: {},
        };
        const contractRegistry = createBuiltinNodeContractRegistry();
        registerSerializableNodeContract(contractRegistry, {
            identity: pluginNodeIdentity(pid('com.example.tick'), 'tick-trigger'),
            version: 1,
            role: 'trigger',
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig: {},
            outputPorts: {
                kind: 'fixed',
                ports: [{ id: 'out', label: 'Output' }],
            },
            display: {
                label: 'Tick Trigger',
                description: 'Starts a Workflow on a tick.',
                category: 'trigger',
            },
        });
        const result = validateWorkflowTopology(
            pipeline([plugin, log('log')], [edge('plugin-log', 'plugin-trigger', 'log')]),
            {
                contractRegistry,
            },
        );

        expect(result.ok).toBe(true);
    });

    it('reports invalid configuration for a derived Plugin contract before Edge admission', () => {
        const contractRegistry = createBuiltinNodeContractRegistry();
        registerSerializableNodeContract(contractRegistry, {
            identity: pluginNodeIdentity(pid('com.example.router'), 'router-node'),
            version: 1,
            role: 'action',
            configSchema: {
                version: 1,
                dialect: 'https://json-schema.org/draft/2020-12/schema',
                schema: {
                    type: 'object',
                    properties: {
                        target: { const: 'event' },
                        cases: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    value: { type: 'string' },
                                },
                                required: ['id', 'value'],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ['target', 'cases'],
                    additionalProperties: false,
                },
            },
            defaultConfig: {
                target: 'event',
                cases: [{ id: 'ready', value: 'ready' }],
            },
            outputPorts: switchOutputPortSpec(),
            display: {
                label: 'Router Node',
                description: 'Routes by event name.',
                category: 'logic',
            },
        });

        const result = validateWorkflowTopology(
            pipeline(
                [
                    trigger('trigger'),
                    {
                        id: PipelineNodeIdSchema.parse('router'),
                        type: nt('router-node'),
                        pluginId: pid('com.example.router'),
                        config: {
                            target: 'event',
                            cases: [{ id: 'empty', value: '' }],
                        },
                    },
                    log('log'),
                ],
                [
                    edge('trigger-router', 'trigger', 'router'),
                    edge('router-log', 'router', 'log', 'empty'),
                ],
            ),
            {
                contractRegistry,
                isNodeSupported: () => true,
            },
        );

        expect(result).toMatchObject({
            ok: false,
            diagnostics: [
                expect.objectContaining({
                    code: 'invalid_node_contract',
                    target: { kind: 'node', nodeId: 'router' },
                    details: expect.objectContaining({ code: 'empty_match_value' }),
                    fieldPath: 'config.cases[0].value',
                }),
            ],
        });
        if (!result.ok) {
            expect(result.diagnostics).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'invalid_output_port',
                        target: { kind: 'edge', edgeId: 'router-log' },
                    }),
                ]),
            );
        }
    });

    it('does not infer dynamic output ports for an unavailable Plugin contract', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [
                    trigger('trigger'),
                    {
                        id: PipelineNodeIdSchema.parse('unknown'),
                        type: nt('unknown-node'),
                        pluginId: pid('com.example.missing'),
                        config: {},
                    },
                    log('log'),
                ],
                [
                    edge('trigger-unknown', 'trigger', 'unknown'),
                    edge('unknown-log', 'unknown', 'log'),
                ],
            ),
            { isNodeSupported: () => true },
        );

        expect(result).toMatchObject({
            ok: false,
            diagnostics: [
                expect.objectContaining({
                    code: 'invalid_output_port',
                    target: { kind: 'edge', edgeId: 'unknown-log', relatedNodeId: 'unknown' },
                }),
            ],
        });
    });

    it('reports an unavailable Plugin contract during strict admission', () => {
        const result = validateWorkflowTopology(
            pipeline(
                [
                    trigger('trigger'),
                    {
                        id: PipelineNodeIdSchema.parse('unknown'),
                        type: nt('unknown-node'),
                        pluginId: pid('com.example.missing'),
                        config: {},
                    },
                ],
                [edge('trigger-unknown', 'trigger', 'unknown')],
            ),
            { requireNodeContracts: true },
        );

        expect(result).toMatchObject({
            ok: false,
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'unavailable_node_contract',
                    target: { kind: 'node', nodeId: 'unknown' },
                }),
            ]),
        });
    });

    it('reports duplicate Nodes, duplicate Edges, and Edges with missing endpoints', () => {
        const duplicateNodes = validateWorkflowTopology(
            pipeline([trigger('trigger'), trigger('trigger')], []),
        );
        expect(diagnosticCodes(duplicateNodes)).toContain('duplicate_node_id');
        if (!duplicateNodes.ok) {
            expect(
                duplicateNodes.diagnostics.filter(
                    (diagnostic) => diagnostic.code === 'duplicate_node_id',
                ),
            ).toHaveLength(1);
        }

        const duplicateEdges = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('log')],
                [edge('same-edge', 'trigger', 'log'), edge('same-edge', 'trigger', 'log')],
            ),
        );
        expect(diagnosticCodes(duplicateEdges)).toContain('duplicate_edge_id');

        const missingEndpoints = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), log('log')],
                [
                    edge('missing-source', 'missing', 'log'),
                    edge('missing-target', 'trigger', 'missing'),
                ],
            ),
        );
        expect(diagnosticCodes(missingEndpoints)).toContain('invalid_edge');
    });

    it('reports an unsupported Node handler as a structured diagnostic', () => {
        const unsupported: PipelineNode = {
            id: PipelineNodeIdSchema.parse('missing'),
            type: nt('missing-node'),
            pluginId: pid('com.example.missing'),
            config: {},
        };
        const result = validateWorkflowTopology(
            pipeline(
                [trigger('trigger'), unsupported],
                [edge('trigger-missing', 'trigger', 'missing')],
            ),
            { isNodeSupported: (node) => node.id !== 'missing' },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unsupported_node_handler',
                        target: { kind: 'node', nodeId: 'missing' },
                    }),
                ]),
            );
        }
    });

    it('formats optional diagnostic field paths and repair hints', () => {
        const diagnostics = [
            {
                severity: 'error',
                code: 'invalid_node_contract',
                target: { kind: 'node', nodeId: PipelineNodeIdSchema.parse('router') },
                fieldPath: 'config.cases[0].value',
                message: 'The match value is empty.',
                repairHint: 'Enter a non-empty match value.',
            },
            {
                severity: 'warning',
                code: 'invalid_edge',
                target: { kind: 'edge', edgeId: PipelineEdgeIdSchema.parse('edge-1') },
                message: 'Reconnect the Edge.',
            },
        ] as const;

        expect(formatTopologyDiagnostics(diagnostics)).toBe(
            '[invalid_node_contract] (config.cases[0].value) The match value is empty. ' +
                'Repair: Enter a non-empty match value.\n' +
                '[invalid_edge] Reconnect the Edge.',
        );
    });
});
