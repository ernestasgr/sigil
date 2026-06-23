import { describe, expect, it } from 'vitest';
import { PipelineConditionSchema } from './conditions.js';
import { FileEventPayloadSchema } from './file-event-payload.js';
import { CompiledPipelineSchema, parsePipeline } from './pipeline.js';
import { sampleManualTriggerToLog } from './samples.js';

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

describe('CompiledPipelineSchema', () => {
    it('validates the manual-trigger -> log sample', () => {
        const result = CompiledPipelineSchema.safeParse(sampleManualTriggerToLog);
        expect(result.success).toBe(true);
    });

    it('parsePipeline returns ok for the sample', () => {
        const result = parsePipeline(sampleManualTriggerToLog);
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
        const result = parsePipeline(invalid);
        expect(result.ok === false && result.error.length).toBeGreaterThan(0);
    });

    it('rejects a missing required config field with a clear error', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'n', type: 'delay', config: {} }],
            edges: [],
        };
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/ms/);
        }
    });

    it('rejects an edge with an invalid source port for an if-else node', () => {
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
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/invalid sourcePort "maybe"/);
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
                    config: { target: 'payload', field: 'ext', cases: ['pdf', 'png'] },
                },
                { id: 'log', type: 'log', config: { message: 'x' } },
            ],
            edges: [
                { id: 'e1', source: 'sw', target: 'log', sourcePort: 'pdf' },
                { id: 'e2', source: 'sw', target: 'log', sourcePort: 'default' },
            ],
        };
        const result = CompiledPipelineSchema.safeParse(valid);
        expect(result.success).toBe(true);
    });

    it('rejects an edge referencing an unknown source node', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [{ id: 'log', type: 'log', config: { message: 'x' } }],
            edges: [{ id: 'e', source: 'ghost', target: 'log', sourcePort: 'out' }],
        };
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/unknown source node/);
        }
    });

    it('rejects duplicate node ids', () => {
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
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/Duplicate node id/);
        }
    });

    it('rejects an unsupported schema version', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 2,
            nodes: [],
            edges: [],
        };
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
    });

    it('rejects a switch with duplicate case values', () => {
        const invalid = {
            id: 'p',
            workflowId: 'w',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'sw',
                    type: 'switch',
                    config: { target: 'payload', field: 'ext', cases: ['pdf', 'pdf'] },
                },
            ],
            edges: [],
        };
        const result = parsePipeline(invalid);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/unique/);
        }
    });
});
