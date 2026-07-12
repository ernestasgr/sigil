import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    EngineChannel,
    EngineCreateWorkflowSchema,
    EngineDeleteWorkflowSchema,
    EngineMessageSchema,
    type EnginePing,
    type EnginePong,
    EngineReadySchema,
    type EngineToggleWorkflow,
    EngineUpdateWorkflowSchema,
    EngineWorkflowsListSchema,
    WorkerInboundSchema,
    WorkflowIdSchema,
} from './ipc-channels.js';

describe('WorkerInboundSchema', () => {
    it('accepts a well-formed ping message', () => {
        const message: unknown = { id: 'test-1', type: EngineChannel.Ping };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a message with an unknown type', () => {
        const message = { type: 'engine:unknown-op' };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects a ping message missing the id field', () => {
        const message = { type: EngineChannel.Ping };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects a completely unrelated object', () => {
        const message = { foo: 'bar' };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects null', () => {
        const result = WorkerInboundSchema.safeParse(null);
        expect(result.success).toBe(false);
    });
});

describe('EngineMessageSchema', () => {
    it('accepts a well-formed ping message', () => {
        const message: EnginePing = { id: 'test-1', type: EngineChannel.Ping };
        const result = EngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed pong message', () => {
        const message: EnginePong = {
            id: 'test-1',
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        const result = EngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed toggle-workflow message', () => {
        const message: EngineToggleWorkflow = {
            type: EngineChannel.ToggleWorkflow,
            correlationId: 'corr-1',
            id: 'wf-1',
        };
        const result = EngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a toggle-workflow message with a missing correlationId', () => {
        const message = { type: EngineChannel.ToggleWorkflow, id: 'wf-1' };
        const result = EngineMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects an unknown type', () => {
        const message = { type: 'engine:does-not-exist' };
        const result = EngineMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });
});

describe('EngineWorkflowsListSchema', () => {
    it('preserves repair diagnostics for malformed stored Workflows', () => {
        const result = EngineWorkflowsListSchema.safeParse({
            type: EngineChannel.WorkflowsList,
            workflows: [
                {
                    id: 'wf-broken',
                    name: 'Broken',
                    enabled: false,
                    diagnostics: [
                        {
                            severity: 'error',
                            code: 'invalid_pipeline',
                            target: { kind: 'pipeline' },
                            message: 'Repair or remove the stored file.',
                        },
                    ],
                },
            ],
        });

        expect(result.success).toBe(true);
    });

    it('allows invalid filename ids in recovery summaries', () => {
        const result = EngineWorkflowsListSchema.safeParse({
            type: EngineChannel.WorkflowsList,
            workflows: [
                {
                    id: 'bad name',
                    name: 'Unreadable Workflow (bad name)',
                    enabled: false,
                    diagnostics: [
                        {
                            severity: 'error',
                            code: 'invalid_pipeline',
                            target: { kind: 'pipeline' },
                            message: 'Repair or remove the stored file.',
                        },
                    ],
                },
            ],
        });

        expect(result.success).toBe(true);
    });
});

describe('EngineReadySchema', () => {
    it('accepts the engine:ready sentinel', () => {
        const message = { type: 'engine:ready' };
        const result = EngineReadySchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts engine:ready with extra fields (zod strips unknown keys by default)', () => {
        const message = { type: 'engine:ready', extra: true };
        const result = EngineReadySchema.safeParse(message);
        expect(result.success).toBe(true);
    });
});

describe('WorkflowIdSchema', () => {
    it('accepts a non-empty string', () => {
        const result = WorkflowIdSchema.safeParse('wf-123');
        expect(result.success).toBe(true);
    });

    it('rejects an empty string', () => {
        const result = WorkflowIdSchema.safeParse('');
        expect(result.success).toBe(false);
    });

    it('rejects a non-string value', () => {
        const result = WorkflowIdSchema.safeParse(42);
        expect(result.success).toBe(false);
    });

    it.each([
        '../outside',
        '..\\outside',
        '/tmp/outside',
        'C:\\tmp\\outside',
    ])('rejects a path-shaped identifier: %s', (id) => {
        expect(WorkflowIdSchema.safeParse(id).success).toBe(false);
    });
});

describe('EngineUpdateWorkflowSchema', () => {
    const pipeline = {
        id: 'pipeline-1',
        workflowId: 'wf-1',
        schemaVersion: 1 as const,
        nodes: [],
        edges: [],
    };

    it('requires the request id and Pipeline workflowId to agree', () => {
        const result = EngineUpdateWorkflowSchema.safeParse({
            type: EngineChannel.UpdateWorkflow,
            correlationId: 'corr-1',
            id: 'wf-2',
            name: 'Workflow',
            pipeline,
            positions: {},
        });

        expect(result.success).toBe(false);
    });

    it('accepts an aligned Workflow identity', () => {
        const result = EngineUpdateWorkflowSchema.safeParse({
            type: EngineChannel.UpdateWorkflow,
            correlationId: 'corr-1',
            id: 'wf-1',
            name: 'Workflow',
            pipeline,
            positions: {},
        });

        expect(result.success).toBe(true);
    });
});

describe('Workflow command identity schemas', () => {
    it('rejects a traversal-shaped Workflow id in a create Pipeline', () => {
        const result = EngineCreateWorkflowSchema.safeParse({
            type: EngineChannel.CreateWorkflow,
            correlationId: 'corr-1',
            name: 'Workflow',
            pipeline: {
                id: 'pipeline-1',
                workflowId: '../outside',
                schemaVersion: 1,
                nodes: [],
                edges: [],
            },
            positions: {},
        });

        expect(result.success).toBe(false);
    });

    it('rejects an absolute Workflow id in a delete command', () => {
        const result = EngineDeleteWorkflowSchema.safeParse({
            type: EngineChannel.DeleteWorkflow,
            correlationId: 'corr-1',
            id: 'C:\\tmp\\outside',
        });

        expect(result.success).toBe(false);
    });
});

describe('EngineMessageSchema composition with EngineReadySchema', () => {
    it('engine:ready is NOT accepted by EngineMessageSchema', () => {
        const result = EngineMessageSchema.safeParse({ type: 'engine:ready' });
        expect(result.success).toBe(false);
    });

    it('a union of EngineMessageSchema and EngineReadySchema accepts both', () => {
        const combined = z.union([EngineMessageSchema, EngineReadySchema]);
        const ping: EnginePing = { id: 'test-1', type: EngineChannel.Ping };
        expect(combined.safeParse(ping).success).toBe(true);
        expect(combined.safeParse({ type: 'engine:ready' }).success).toBe(true);
        expect(combined.safeParse({ type: 'does-not-exist' }).success).toBe(false);
    });
});
