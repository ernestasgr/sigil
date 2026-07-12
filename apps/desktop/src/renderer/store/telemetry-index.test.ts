import { describe, expect, it } from 'vitest';

import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';

import { createTelemetryEntry, createTelemetryIndex } from './telemetry-index.js';

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
});
