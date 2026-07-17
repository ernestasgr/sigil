import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    EngineBusEventSchema,
    EngineChannel,
    EngineCreateWorkflowSchema,
    EngineDeleteWorkflowSchema,
    type EnginePing,
    type EnginePong,
    EngineReadySchema,
    type EngineToggleWorkflow,
    EngineToMainMessageSchema,
    EngineUpdateWorkflowSchema,
    EngineWorkflowsListSchema,
    MainToEngineMessageSchema,
    WorkerInboundSchema,
    WorkflowIdSchema,
    WorkflowStateEntrySchema,
    WorkflowStateValueSchema,
} from './ipc-channels.js';

describe('WorkerInboundSchema', () => {
    it('accepts a well-formed ping message', () => {
        const message: unknown = {
            correlationId: 'corr-test-1',
            type: EngineChannel.Ping,
        };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a message with an unknown type', () => {
        const message = { type: 'engine:unknown-op' };
        const result = WorkerInboundSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects a ping message missing the correlation id field', () => {
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

describe('EngineToMainMessageSchema', () => {
    it('accepts a well-formed ping message', () => {
        const message: EnginePing = {
            correlationId: 'corr-test-1',
            type: EngineChannel.Ping,
        };
        const result = MainToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed pong message', () => {
        const message: EnginePong = {
            correlationId: 'corr-test-1',
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        const result = EngineToMainMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed toggle-workflow message', () => {
        const message: EngineToggleWorkflow = {
            type: EngineChannel.ToggleWorkflow,
            correlationId: 'corr-1',
            id: 'wf-1',
        };
        const result = MainToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a toggle-workflow message with a missing correlationId', () => {
        const message = { type: EngineChannel.ToggleWorkflow, id: 'wf-1' };
        const result = MainToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects an unknown type', () => {
        const message = { type: 'engine:does-not-exist' };
        const result = EngineToMainMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('preserves structured persistence failures in result messages', () => {
        const result = EngineToMainMessageSchema.safeParse({
            type: EngineChannel.SavePropertiesResult,
            correlationId: 'corr-persistence',
            ok: false,
            error: 'replacement denied',
            diagnostic: {
                kind: 'persistence',
                operation: 'write',
                phase: 'replace',
                path: 'C:/sigil.properties.json',
                message: 'replacement denied',
            },
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toMatchObject({
                ok: false,
                diagnostic: { phase: 'replace' },
            });
        }
    });

    it('does not strip a Workflow toggle persistence failure as a success response', () => {
        const result = EngineToMainMessageSchema.safeParse({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'corr-toggle',
            summary: null,
            error: 'Could not toggle Workflow "wf-1"',
            diagnostics: [
                {
                    kind: 'persistence',
                    operation: 'write',
                    phase: 'replace',
                    path: 'C:/workflows/wf-1.json',
                    message: 'replacement denied',
                },
            ],
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect('error' in result.data).toBe(true);
        }
    });

    it.each([
        EngineChannel.ToggleWorkflowResult,
        EngineChannel.RetryWorkflowResult,
    ])('rejects a %s success response with unknown fields', (type) => {
        const result = EngineToMainMessageSchema.safeParse({
            type,
            correlationId: 'corr-action-extra',
            summary: null,
            extra: true,
        });

        expect(result.success).toBe(false);
    });

    it.each([
        EngineChannel.ToggleWorkflowResult,
        EngineChannel.RetryWorkflowResult,
    ])('rejects a %s failure when its diagnostics are invalid', (type) => {
        const result = EngineToMainMessageSchema.safeParse({
            type,
            correlationId: 'corr-action-invalid',
            summary: null,
            error: 42,
            diagnostics: [],
        });

        expect(result.success).toBe(false);
    });

    it('does not let an invalid delete failure fall through to not-found', () => {
        const result = EngineToMainMessageSchema.safeParse({
            type: EngineChannel.DeleteWorkflowResult,
            correlationId: 'corr-delete-invalid',
            success: false,
            error: 'replacement denied',
            diagnostic: { invalid: true },
        });

        expect(result.success).toBe(false);
    });

    it('rejects a delete success response with unknown fields', () => {
        const result = EngineToMainMessageSchema.safeParse({
            type: EngineChannel.DeleteWorkflowResult,
            correlationId: 'corr-delete-extra',
            success: false,
            extra: true,
        });

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

describe('EngineBusEventSchema', () => {
    it('preserves correlated Engine telemetry through the IPC envelope', () => {
        const result = EngineBusEventSchema.safeParse({
            type: EngineChannel.BusEvent,
            event: {
                name: 'node.completed',
                timestamp: 1234,
                payload: {
                    pipelineId: 'pipeline-1',
                    workflowId: 'workflow-1',
                    runId: 'run-1',
                    nodeId: 'node-1',
                    nodeType: 'log',
                    outcome: 'succeeded',
                    durationMs: 12,
                },
                telemetry: {
                    eventId: 'event-1',
                    timestamp: 1234,
                    kind: 'node',
                    severity: 'info',
                    workflowId: 'workflow-1',
                    pipelineId: 'pipeline-1',
                    runId: 'run-1',
                    nodeId: 'node-1',
                    nodeType: 'log',
                    outcome: 'succeeded',
                    durationMs: 12,
                    summary: '{"outcome":"succeeded"}',
                },
            },
        });

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

describe('Workflow State schemas', () => {
    it('accepts discriminated string, number, and boolean entries', () => {
        expect(
            WorkflowStateEntrySchema.array().safeParse([
                { key: 'text', type: 'string', value: '42' },
                { key: 'count', type: 'number', value: 42 },
                { key: 'enabled', type: 'boolean', value: false },
            ]).success,
        ).toBe(true);
    });

    it('rejects a Workflow State value whose type and payload disagree', () => {
        expect(WorkflowStateValueSchema.safeParse({ type: 'number', value: '42' }).success).toBe(
            false,
        );
    });

    it('rejects an untyped Engine-to-Main Workflow State entry', () => {
        expect(
            EngineToMainMessageSchema.safeParse({
                type: EngineChannel.ReadWorkflowStateResult,
                correlationId: 'corr-state',
                entries: [{ key: 'count', value: 42 }],
            }).success,
        ).toBe(false);
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

describe('EngineToMainMessageSchema composition with EngineReadySchema', () => {
    it('engine:ready is NOT accepted by EngineToMainMessageSchema', () => {
        const result = EngineToMainMessageSchema.safeParse({ type: 'engine:ready' });
        expect(result.success).toBe(false);
    });

    it('a union of EngineToMainMessageSchema and EngineReadySchema accepts both', () => {
        const combined = z.union([EngineToMainMessageSchema, EngineReadySchema]);
        const pong: EnginePong = {
            correlationId: 'corr-test-1',
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        expect(combined.safeParse(pong).success).toBe(true);
        expect(combined.safeParse({ type: 'engine:ready' }).success).toBe(true);
        expect(combined.safeParse({ type: 'does-not-exist' }).success).toBe(false);
    });
});
