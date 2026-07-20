import { describe, expect, it } from 'vitest';

import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';

import {
    createTelemetryEntry,
    createTelemetryIndex,
    formatTelemetryExport,
    isTelemetryFailure,
} from './telemetry-index.js';

const correlatedEvent: EngineBusEventPayload = {
    name: 'log.output',
    payload: { message: 'sorted file' },
    timestamp: 1700000000000,
    telemetry: {
        eventId: 'event-1',
        timestamp: 1700000000000,
        kind: 'node',
        severity: 'info',
        workflowId: 'workflow-a',
        pipelineId: 'pipeline-a',
        runId: 'run-a',
        summary: '{"message":"sorted file"}',
    },
};

describe('telemetry index', () => {
    it('retrieves a correlated Workflow entry using Engine event time', () => {
        const entry = createTelemetryEntry(1, correlatedEvent, 1800000000000);
        const index = createTelemetryIndex().append(entry);

        expect(entry.timestamp).toBe(1700000000000);
        expect(index.workflowIds).toEqual(['workflow-a']);
        expect(index.forWorkflow('workflow-a')).toEqual([entry]);
        expect(index.forRun('run-a', 'workflow-a')).toEqual([entry]);
    });

    it('evicts the oldest entry while keeping Workflow and run indexes bounded', () => {
        const first = createTelemetryEntry(1, correlatedEvent);
        const second = createTelemetryEntry(2, {
            ...correlatedEvent,
            telemetry: {
                eventId: 'event-2',
                timestamp: 1700000000000,
                kind: 'node',
                severity: 'info',
                workflowId: 'workflow-b',
                pipelineId: 'pipeline-b',
                runId: 'run-b',
                summary: '{"message":"sorted file"}',
            },
        });
        const third = createTelemetryEntry(3, {
            ...correlatedEvent,
            telemetry: {
                eventId: 'event-3',
                timestamp: 1700000000000,
                kind: 'node',
                severity: 'info',
                workflowId: 'workflow-c',
                pipelineId: 'pipeline-c',
                runId: 'run-c',
                summary: '{"message":"sorted file"}',
            },
        });

        const index = createTelemetryIndex(2).append(first).append(second).append(third);

        expect(index.entries.map((entry) => entry.id)).toEqual([2, 3]);
        expect(index.workflowIds).toEqual(['workflow-b', 'workflow-c']);
        expect(index.forWorkflow('workflow-a')).toEqual([]);
        expect(index.forRun('run-b', 'workflow-b').map((entry) => entry.id)).toEqual([2]);
    });

    it('keeps Workflow-scoped queries isolated when run identifiers are reused', () => {
        const workflowA = createTelemetryEntry(1, correlatedEvent);
        const workflowB = createTelemetryEntry(2, {
            ...correlatedEvent,
            telemetry: {
                eventId: 'event-b',
                timestamp: 1700000000000,
                kind: 'node',
                severity: 'info',
                workflowId: 'workflow-b',
                pipelineId: 'pipeline-b',
                runId: 'run-a',
                summary: '{"message":"other workflow"}',
            },
        });

        const index = createTelemetryIndex().append(workflowA).append(workflowB);

        expect(index.forWorkflow('workflow-a').map((entry) => entry.id)).toEqual([1]);
        expect(index.forRun('run-a', 'workflow-a').map((entry) => entry.id)).toEqual([1]);
        expect(index.forRun('run-a', 'workflow-b').map((entry) => entry.id)).toEqual([2]);
    });

    it('returns only failed Workflow entries for a failure-focused history view', () => {
        const succeeded = createTelemetryEntry(1, correlatedEvent);
        const failed = createTelemetryEntry(2, {
            ...correlatedEvent,
            name: 'workflow.error',
            telemetry: {
                eventId: 'event-failed',
                timestamp: 1700000000000,
                kind: 'outcome',
                severity: 'error',
                workflowId: 'workflow-a',
                pipelineId: 'pipeline-a',
                runId: 'run-a',
                outcome: 'failed',
                summary: '{"message":"failure"}',
            },
        });

        const index = createTelemetryIndex().append(succeeded).append(failed);

        expect(index.failuresForWorkflow('workflow-a').map((entry) => entry.id)).toEqual([2]);
    });

    it('exports diagnostic identity without raw payloads and redacts sensitive summaries', () => {
        const entry = createTelemetryEntry(1, {
            name: 'engine.diagnostic',
            payload: {
                pluginId: 'com.example.plugin',
                password: 'payload-secret',
            },
            telemetry: {
                eventId: 'diagnostic-1',
                timestamp: 1700000000000,
                kind: 'diagnostic',
                severity: 'error',
                pluginId: 'com.example.plugin',
                outcome: 'failed',
                summary: '{"token":"summary-secret","message":"authorization: Bearer raw-secret"}',
            },
        });

        const output = formatTelemetryExport([entry]);

        expect(output).toContain('com.example.plugin');
        expect(output).toContain('[REDACTED]');
        expect(output).not.toContain('payload-secret');
        expect(output).not.toContain('summary-secret');
        expect(output).not.toContain('raw-secret');
    });

    it('does not index diagnostic fields from an invalid registered payload', () => {
        const entry = createTelemetryEntry(1, {
            name: 'engine.diagnostic',
            payload: { message: 42, source: 'worker', outcome: 'failed' },
        });

        expect(isTelemetryFailure(entry)).toBe(false);
        const output = formatTelemetryExport([entry]);
        expect(output).toContain('[PAYLOAD_OMITTED]');
        expect(output).not.toContain('"source": "worker"');
        expect(output).not.toContain('"outcome": "failed"');
    });

    it('keeps unscoped worker diagnostics in the same bounded history', () => {
        const diagnostic = createTelemetryEntry(1, {
            name: 'engine.diagnostic',
            payload: {
                message: 'Plugin worker stopped unexpectedly',
                kind: 'worker',
                source: 'plugin',
                pluginId: 'com.example.plugin',
                outcome: 'failed',
            },
        });
        const event = createTelemetryEntry(2, correlatedEvent);

        const index = createTelemetryIndex().append(diagnostic).append(event);

        expect(index.diagnostics().map((entry) => entry.id)).toEqual([1]);
        const output = formatTelemetryExport(index.diagnostics());
        expect(output).toContain('com.example.plugin');
        expect(output).toContain('failed');
        expect(output).toContain('Plugin worker stopped unexpectedly');
    });
});
