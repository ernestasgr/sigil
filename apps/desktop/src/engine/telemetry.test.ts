import { describe, expect, it } from 'vitest';

import { type BusEvent, createEventBus } from './event-bus.js';
import { createRunTelemetry } from './telemetry.js';

describe('run telemetry', () => {
    it('correlates events with engine time and a bounded redacted summary', () => {
        const bus = createEventBus();
        const events: BusEvent[] = [];
        bus.subscribe((event) => events.push(event));

        const telemetry = createRunTelemetry(
            bus,
            { workflowId: 'workflow-1', pipelineId: 'pipeline-1', runId: 'run-1' },
            {
                now: () => 1234,
                createEventId: () => 'event-1',
            },
        );

        telemetry.emit(
            {
                name: 'plugin.event',
                payload: {
                    pluginId: 'com.example.plugin',
                    eventName: 'plugin.output',
                    data: {
                        message: 'authorization: Bearer also-do-not-leak',
                        token: 'do-not-leak',
                    },
                },
            },
            { kind: 'plugin', nodeId: 'node-1', nodeType: 'plugin-node' },
        );

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            name: 'plugin.event',
            timestamp: 1234,
            telemetry: {
                eventId: 'event-1',
                timestamp: 1234,
                kind: 'plugin',
                workflowId: 'workflow-1',
                pipelineId: 'pipeline-1',
                runId: 'run-1',
                nodeId: 'node-1',
                nodeType: 'plugin-node',
            },
        });
        expect(events[0]?.telemetry?.summary).not.toContain('do-not-leak');
    });

    it('falls back for non-finite timestamps and omits non-finite durations', () => {
        const bus = createEventBus();
        const events: BusEvent[] = [];
        bus.subscribe((event) => events.push(event));

        const telemetry = createRunTelemetry(
            bus,
            { workflowId: 'workflow-1', pipelineId: 'pipeline-1', runId: 'run-1' },
            { now: () => 1234, createEventId: () => 'event-1' },
        );

        telemetry.emit(
            { name: 'log.output', payload: { message: 'hello' } },
            { timestamp: Number.NaN, durationMs: Number.POSITIVE_INFINITY },
        );

        expect(events[0]).toMatchObject({
            timestamp: 1234,
            telemetry: { timestamp: 1234 },
        });
        expect(events[0]?.telemetry).not.toHaveProperty('durationMs');
    });

    it('publishes a terminal node outcome once with its duration', () => {
        const bus = createEventBus();
        const events: BusEvent[] = [];
        bus.subscribe((event) => events.push(event));
        const times = [100, 125];

        const telemetry = createRunTelemetry(
            bus,
            { workflowId: 'workflow-1', pipelineId: 'pipeline-1', runId: 'run-1' },
            {
                now: () => times.shift() ?? 125,
                createEventId: (() => {
                    let next = 1;
                    return () => `event-${next++}`;
                })(),
            },
        );

        const node = telemetry.forNode({ nodeId: 'node-1', nodeType: 'delay' });
        const span = node.start();
        span.finish('succeeded');
        span.finish('failed', 'ignored duplicate finish');

        expect(events.map((event) => event.name)).toEqual(['node.started', 'node.completed']);
        expect(events[1]?.payload).toMatchObject({
            nodeId: 'node-1',
            nodeType: 'delay',
            outcome: 'succeeded',
            durationMs: 25,
        });
        expect(events[1]?.telemetry).toMatchObject({
            outcome: 'succeeded',
            durationMs: 25,
            timestamp: 125,
        });
    });

    it('keeps plugin diagnostic identity and failure outcome on a Workflow-scoped sink', () => {
        const bus = createEventBus();
        const events: BusEvent[] = [];
        bus.subscribe((event) => events.push(event));

        const telemetry = createRunTelemetry(
            bus,
            { workflowId: 'workflow-1', pipelineId: 'pipeline-1', runId: 'run-1' },
            { now: () => 1234, createEventId: () => 'diagnostic-1' },
        );

        telemetry
            .forNode({ nodeId: 'node-1', nodeType: 'plugin-node', pluginId: 'plugin-1' })
            .bus.next({
                name: 'engine.diagnostic',
                payload: {
                    message: 'Permission denied: filesystem.read',
                    kind: 'authorization',
                    source: 'plugin',
                    pluginId: 'plugin-1',
                    outcome: 'failed',
                },
            });

        expect(events[0]?.telemetry).toMatchObject({
            kind: 'diagnostic',
            severity: 'error',
            workflowId: 'workflow-1',
            runId: 'run-1',
            nodeId: 'node-1',
            pluginId: 'plugin-1',
            outcome: 'failed',
        });
    });
});
