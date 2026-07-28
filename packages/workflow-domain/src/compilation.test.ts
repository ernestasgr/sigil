import { parseWorkflowDocument } from '@sigil/contracts';
import { PluginIdSchema } from '@sigil/contracts/ids';
import { describe, expect, it } from 'vitest';

import { compileWorkflow } from './compilation.js';
import {
    fixedOutputPortSpec,
    pluginNodeIdentity,
    registerSerializableNodeContract,
} from './node-contract.js';
import { createBuiltinNodeContractRegistry } from './nodes/catalog.js';

const document = {
    id: 'pipeline-seam',
    workflowId: 'workflow-seam',
    schemaVersion: 1,
    nodes: [
        {
            id: 'trigger',
            type: 'manual-trigger',
            config: {
                eventName: 'file.created',
                payload: {
                    path: '/tmp/file.txt',
                    name: 'file.txt',
                    ext: 'txt',
                    size: 1,
                    dir: '/tmp',
                },
            },
        },
        { id: 'log', type: 'log', config: { message: 'compiled' } },
    ],
    edges: [{ id: 'trigger-log', source: 'trigger', target: 'log', sourcePort: 'out' }],
} as const;

describe('WorkflowDocument to CompiledPipeline seam', () => {
    it('parses the document and compiles one admitted execution plan', () => {
        const parsed = parseWorkflowDocument(document);
        expect(parsed).toEqual({ ok: true, value: expect.any(Object) });

        const result = compileWorkflow(document);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.source).toEqual(document);
            expect(result.value.triggerId).toBe('trigger');
            expect(result.value.executionOrder).toEqual(['trigger', 'log']);
            expect(result.value.admittedNodeContracts.map(({ nodeId }) => nodeId)).toEqual([
                'trigger',
                'log',
            ]);
        }
    });

    it('returns typed structural diagnostics without throwing for malformed input', () => {
        const parsed = parseWorkflowDocument({ schemaVersion: 1, nodes: 'not-an-array' });

        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.reason).toBe('malformed');
            expect(parsed.issues.length).toBeGreaterThan(0);
        }

        const result = compileWorkflow({ schemaVersion: 1, nodes: 'not-an-array' });
        expect(result).toMatchObject({ ok: false, phase: 'parsing' });
    });

    it('distinguishes a future document version from a malformed document', () => {
        const parsed = parseWorkflowDocument({ ...document, schemaVersion: 2 });

        expect(parsed).toMatchObject({ ok: false, reason: 'unsupported_version', version: 2 });
        const result = compileWorkflow({ ...document, schemaVersion: 2 });
        expect(result).toMatchObject({ ok: false, phase: 'parsing' });
        if (!result.ok) {
            expect(result.diagnostics[0]?.code).toBe('unsupported_document_version');
        }
    });

    it('rejects a structurally valid Plugin Node without an admitted contract', () => {
        const result = compileWorkflow({
            ...document,
            nodes: [
                document.nodes[0],
                {
                    id: 'plugin-action',
                    type: 'third-party-action',
                    pluginId: 'com.example.third-party',
                    config: { destination: '/tmp' },
                },
            ],
            edges: [
                ...document.edges,
                { id: 'log-plugin', source: 'log', target: 'plugin-action', sourcePort: 'out' },
            ],
        });

        expect(result).toMatchObject({ ok: false, phase: 'admission' });
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unavailable_node_contract',
                        target: { kind: 'node', nodeId: 'plugin-action' },
                    }),
                ]),
            );
        }
    });

    it('rejects a Plugin Node configuration during Workflow compilation', () => {
        const contractRegistry = createBuiltinNodeContractRegistry();
        registerSerializableNodeContract(contractRegistry, {
            identity: pluginNodeIdentity(
                PluginIdSchema.parse('com.example.config-validation'),
                'config-validation-action',
            ),
            version: 1,
            role: 'action',
            configSchema: {
                version: 1,
                dialect: 'https://json-schema.org/draft/2020-12/schema',
                schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                    additionalProperties: false,
                },
            },
            defaultConfig: { name: 'valid' },
            outputPorts: fixedOutputPortSpec(['out']),
            display: {
                label: 'Config Validation Action',
                description: 'Rejects invalid Plugin configuration during admission.',
                category: 'utility',
            },
        });

        const result = compileWorkflow(
            {
                ...document,
                nodes: [
                    document.nodes[0],
                    {
                        id: 'plugin-action',
                        type: 'config-validation-action',
                        pluginId: 'com.example.config-validation',
                        config: { name: 42 },
                    },
                ],
                edges: [
                    {
                        id: 'trigger-plugin',
                        source: 'trigger',
                        target: 'plugin-action',
                        sourcePort: 'out',
                    },
                ],
            },
            { contractRegistry },
        );

        expect(result).toMatchObject({ ok: false, phase: 'admission' });
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'invalid_node_contract',
                        target: { kind: 'node', nodeId: 'plugin-action' },
                        fieldPath: 'config.name',
                    }),
                ]),
            );
        }
    });

    it('rejects a Node whose runtime handler is not admitted by the target Engine', () => {
        const result = compileWorkflow(document, {
            isNodeSupported: (node) => node.type !== 'log',
        });

        expect(result).toMatchObject({ ok: false, phase: 'admission' });
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unsupported_node_handler',
                        target: { kind: 'node', nodeId: 'log' },
                    }),
                ]),
            );
        }
    });
});
