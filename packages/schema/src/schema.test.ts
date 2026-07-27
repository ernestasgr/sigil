import { describe, expect, it } from 'vitest';
import { PipelineConditionSchema } from './conditions.js';
import { FileEventPayloadSchema } from './file-event-payload.js';
import { MAX_MATCH_PATTERN_LENGTH } from './match-pattern.js';
import { PipelineNodeSchema } from './nodes/index.js';
import { parseWorkflowDocument, WorkflowDocumentSchema } from './pipeline.js';
import { sampleManualTriggerToLog } from './samples.js';
import { validateWorkflowTopology } from './topology.js';
import { WorkflowContextSchema } from './workflow-context.js';

describe('FileEventPayloadSchema', () => {
    it('accepts a well-formed file event payload', () => {
        const result = FileEventPayloadSchema.safeParse({
            path: '/dl/foo.txt',
            name: 'foo.txt',
            ext: 'txt',
            size: 1024,
            dir: '/dl',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a negative size', () => {
        const result = FileEventPayloadSchema.safeParse({
            path: '/dl/foo.txt',
            name: 'foo.txt',
            ext: 'txt',
            size: -1,
            dir: '/dl',
        });
        expect(result.success).toBe(false);
    });
});

describe('PipelineConditionSchema', () => {
    it('accepts an event name condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'event',
            operator: 'equals',
            value: 'file.created',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a noncanonical event name condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'event',
            operator: 'equals',
            value: 'File.Created',
        });
        expect(result.success).toBe(false);
    });

    it('rejects an event name condition with a field', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'event',
            field: 'name',
            operator: 'equals',
            value: 'file.created',
        });
        expect(result.success).toBe(false);
    });

    it('accepts a payload string condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'name',
            operator: 'contains',
            value: 'report',
        });
        expect(result.success).toBe(true);
    });

    it('accepts a Unicode payload match condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'name',
            operator: 'matches',
            value: '/^\\p{L}+$/u',
        });
        expect(result.success).toBe(true);
    });

    it('accepts a pattern-valued Event match condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'event',
            operator: 'matches',
            value: '/^file\\./',
        });
        expect(result.success).toBe(true);
    });

    it('rejects unsupported payload match syntax at the value field', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'name',
            operator: 'matches',
            value: '(?=report)',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        path: ['value'],
                        message: expect.stringMatching(/linear-time/i),
                    }),
                ]),
            );
        }
    });

    it.each(['/report/g', 'a'.repeat(MAX_MATCH_PATTERN_LENGTH + 1)])(
        'rejects invalid match flags or length',
        (value) => {
            const result = PipelineConditionSchema.safeParse({
                target: 'payload',
                field: 'name',
                operator: 'matches',
                value,
            });
            expect(result.success).toBe(false);
        },
    );

    it('accepts a payload size condition with a number operator', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'size',
            operator: 'gt',
            value: 1024,
        });
        expect(result.success).toBe(true);
    });

    it('rejects a number operator paired with a string value', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'size',
            operator: 'gt',
            value: 'foo',
        });
        expect(result.success).toBe(false);
    });

    it('accepts a vars boolean condition', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'vars',
            field: 'enabled',
            operator: 'equals',
            value: true,
        });
        expect(result.success).toBe(true);
    });

    it('rejects an unknown operator', () => {
        const result = PipelineConditionSchema.safeParse({
            target: 'payload',
            field: 'name',
            operator: 'approx',
            value: 'x',
        });
        expect(result.success).toBe(false);
    });
});

describe('WorkflowContextSchema', () => {
    it('accepts an empty event for a non-trigger seed context', () => {
        const result = WorkflowContextSchema.safeParse({
            event: '',
            payload: {},
            vars: {},
        });
        expect(result.success).toBe(true);
    });
});

describe('WorkflowDocumentSchema', () => {
    it('validates the manual-trigger -> log sample', () => {
        const result = WorkflowDocumentSchema.safeParse(sampleManualTriggerToLog.source);
        expect(result.success).toBe(true);
    });

    it('parseWorkflowDocument returns ok for the sample document', () => {
        const result = parseWorkflowDocument(sampleManualTriggerToLog.source);
        expect(result.ok).toBe(true);
    });

    it('rejects an unknown node type', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'n', type: 'does-not-exist', config: {} }],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok === false && result.error.length).toBeGreaterThan(0);
    });

    it('accepts a plugin node with a pluginId and unknown config', () => {
        const valid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'n',
                    type: 'my-plugin-node',
                    pluginId: 'com.sigil.my-plugin',
                    config: { anything: true },
                },
            ],
            edges: [],
        };
        const result = parseWorkflowDocument(valid);
        expect(result.ok).toBe(true);
    });

    it('rejects unknown persisted fields at the structural boundary', () => {
        const result = WorkflowDocumentSchema.safeParse({
            ...sampleManualTriggerToLog.source,
            unexpected: true,
        });
        expect(result.success).toBe(false);

        const invalidNodeConfig = parseWorkflowDocument({
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'log', type: 'log', config: { message: 'x', unexpected: true } }],
            edges: [],
        });
        expect(invalidNodeConfig.ok).toBe(false);
    });

    it('keeps a plugin node when its type matches a builtin node name', () => {
        const result = PipelineNodeSchema.safeParse({
            id: 'n',
            type: 'delay',
            pluginId: 'com.sigil.delay-plugin',
            config: { custom: true },
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect('pluginId' in result.data).toBe(true);
        }
    });

    it('rejects a plugin node without a pluginId', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'n', type: 'my-plugin-node', config: {} }],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(false);
    });

    it('rejects a missing required config field with a clear error', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'n', type: 'delay', config: {} }],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/ms/);
        }
    });

    it('defers invalid source-port admission to topology validation', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'branch',
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
                { id: 'log', type: 'log', config: { message: 'x' } },
            ],
            edges: [{ id: 'e', source: 'branch', target: 'log', sourcePort: 'maybe' }],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const topology = validateWorkflowTopology(result.value);
            expect(topology.ok).toBe(false);
            if (!topology.ok) {
                expect(topology.diagnostics).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ code: 'invalid_output_port' }),
                    ]),
                );
            }
        }
    });

    it('accepts dynamic switch case ports and the default port', () => {
        const valid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'sw',
                    type: 'switch',
                    config: {
                        target: 'payload',
                        field: 'ext',
                        comparison: 'string',
                        cases: [
                            { id: 'pdf', value: 'pdf' },
                            { id: 'png', value: 'png' },
                        ],
                    },
                },
                { id: 'log', type: 'log', config: { message: 'x' } },
            ],
            edges: [
                { id: 'e1', source: 'sw', target: 'log', sourcePort: 'pdf' },
                { id: 'e2', source: 'sw', target: 'log', sourcePort: 'default' },
            ],
        };
        const result = WorkflowDocumentSchema.safeParse(valid);
        expect(result.success).toBe(true);
    });

    it('defers missing edge references to topology validation', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'log', type: 'log', config: { message: 'x' } }],
            edges: [{ id: 'e', source: 'ghost', target: 'log', sourcePort: 'out' }],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const topology = validateWorkflowTopology(result.value);
            expect(topology.ok).toBe(false);
            if (!topology.ok) {
                expect(topology.diagnostics).toEqual(
                    expect.arrayContaining([expect.objectContaining({ code: 'invalid_edge' })]),
                );
            }
        }
    });

    it('defers duplicate node identity admission to topology validation', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                { id: 'log', type: 'log', config: { message: 'a' } },
                { id: 'log', type: 'log', config: { message: 'b' } },
            ],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const topology = validateWorkflowTopology(result.value);
            expect(topology.ok).toBe(false);
            if (!topology.ok) {
                expect(topology.diagnostics).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ code: 'duplicate_node_id' }),
                    ]),
                );
            }
        }
    });

    it('rejects a non-current schema version', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 2,
            nodes: [],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(false);
    });

    it('accepts editable duplicate values at the schema seam and reports them at topology validation', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'sw',
                    type: 'switch',
                    config: {
                        target: 'payload',
                        field: 'ext',
                        comparison: 'string',
                        cases: [
                            { id: 'case-pdf-1', value: 'pdf' },
                            { id: 'case-pdf-2', value: 'pdf' },
                        ],
                    },
                },
            ],
            edges: [],
        };
        const result = parseWorkflowDocument(invalid);
        expect(result.ok).toBe(true);
        if (result.ok) {
            const topology = validateWorkflowTopology(result.value);
            expect(topology.ok).toBe(false);
            if (!topology.ok) {
                expect(topology.diagnostics).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ code: 'duplicate_match_value' }),
                    ]),
                );
            }
        }
    });
});
