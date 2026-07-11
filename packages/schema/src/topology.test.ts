import { describe, expect, it } from 'vitest';

import type { PipelineEdge } from './edges.js';
import type { PipelineNode } from './nodes/index.js';
import type { CompiledPipeline } from './pipeline.js';
import { TopologyDiagnosticSchema, validateWorkflowTopology } from './topology.js';

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
        id: 'pipeline-1',
        workflowId: 'workflow-1',
        schemaVersion: 1,
        nodes: [...nodes],
        edges: [...edges],
    };
}

function diagnosticCodes(result: ReturnType<typeof validateWorkflowTopology>): readonly string[] {
    return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('validateWorkflowTopology', () => {
    it('accepts warning diagnostics as a first-class severity', () => {
        const result = TopologyDiagnosticSchema.safeParse({
            severity: 'warning',
            code: 'invalid_edge',
            target: { kind: 'edge', edgeId: 'edge-1' },
            edgeId: 'edge-1',
            message: 'Reconnect the Edge to a declared output port.',
        });

        expect(result.success).toBe(true);
    });

    it('rejects an empty Pipeline with a repair-oriented diagnostic', () => {
        const result = validateWorkflowTopology({
            id: 'pipeline-1',
            workflowId: 'workflow-1',
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
                    expect.objectContaining({ code: 'unsupported_root', nodeId: 'log' }),
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
                    expect.objectContaining({ code: 'cycle', edgeId: 'a-b' }),
                    expect.objectContaining({ code: 'cycle', edgeId: 'b-a' }),
                ]),
            );
        }
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
                    expect.objectContaining({ code: 'disconnected_node', nodeId: 'orphan' }),
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
                    expect.objectContaining({ code: 'implicit_join', nodeId: 'joined' }),
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
                        edgeId: 'e1',
                        nodeId: 'trigger',
                    }),
                ]),
            );
        }
    });

    it('allows a plugin Node to declare trigger and output-port capabilities', () => {
        const plugin: PipelineNode = {
            id: 'plugin-trigger',
            type: 'tick-trigger',
            pluginId: 'com.example.tick',
            config: {},
        };
        const result = validateWorkflowTopology(
            pipeline([plugin, log('log')], [edge('plugin-log', 'plugin-trigger', 'log')]),
            {
                isTrigger: (node) => node.id === 'plugin-trigger',
                outputPortsForNode: () => ['out'],
            },
        );

        expect(result.ok).toBe(true);
    });

    it('reports an unsupported Node handler as a structured diagnostic', () => {
        const unsupported: PipelineNode = {
            id: 'missing',
            type: 'missing-node',
            pluginId: 'com.example.missing',
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
                        nodeId: 'missing',
                        target: { kind: 'node', nodeId: 'missing' },
                    }),
                ]),
            );
        }
    });
});
