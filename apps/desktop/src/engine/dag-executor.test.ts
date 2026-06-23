import { describe, expect, it } from 'vitest';

import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineEdge } from '@sigil/schema/edges';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { PipelineNode } from '@sigil/schema/nodes';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { executePipeline, type ExecutorSettings } from './dag-executor.js';

function captureEvents(bus: ReturnType<typeof createEventBus>): BusEvent[] {
    const events: BusEvent[] = [];
    bus.subscribe((event) => {
        events.push(event);
    });
    return events;
}

const payload: FileEventPayload = {
    path: '/Users/dev/Downloads/report.pdf',
    name: 'report.pdf',
    ext: 'pdf',
    size: 2048576,
    dir: '/Users/dev/Downloads',
};

const trigger = (id = 'trigger'): PipelineNode => ({
    id,
    type: 'manual-trigger',
    config: { payload },
});
const log = (id: string, message: string): PipelineNode => ({
    id,
    type: 'log',
    config: { message },
});
const edge = (id: string, source: string, target: string, sourcePort: string): PipelineEdge => ({
    id,
    source,
    target,
    sourcePort,
});
const pipeline = (
    nodes: readonly PipelineNode[],
    edges: readonly PipelineEdge[],
): CompiledPipeline => ({
    id: 'test-pipeline',
    workflowId: 'test-workflow',
    schemaVersion: 1,
    nodes: [...nodes],
    edges: [...edges],
});

describe('executePipeline — tracer sample', () => {
    it('emits a log.output event with the rendered sample message', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(sampleManualTriggerToLog, bus);

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent).toBeDefined();
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'Manual trigger fired for report.pdf (2048576 bytes)',
        );
    });

    it('emits workflow lifecycle and trigger events in order', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(sampleManualTriggerToLog, bus);

        expect(events.map((event) => event.name)).toEqual([
            'workflow.started',
            'manual.trigger.fired',
            'log.output',
            'workflow.completed',
        ]);
    });

    it('fires the manual trigger with the payload from the node config', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(sampleManualTriggerToLog, bus);

        const triggerEvent = events.find((event) => event.name === 'manual.trigger.fired');
        expect(triggerEvent?.name === 'manual.trigger.fired' && triggerEvent.payload).toEqual(
            payload,
        );
    });
});

describe('executePipeline — if/else branching', () => {
    const branchPipeline = (conditionValue: string): CompiledPipeline =>
        pipeline(
            [
                trigger(),
                {
                    id: 'branch',
                    type: 'if-else',
                    config: {
                        condition: {
                            target: 'event',
                            field: 'ext',
                            operator: 'equals',
                            value: conditionValue,
                        },
                    },
                },
                log('true-log', 'took the TRUE branch'),
                log('false-log', 'took the FALSE branch'),
            ],
            [
                edge('t-to-branch', 'trigger', 'branch', 'out'),
                edge('branch-to-true', 'branch', 'true-log', 'true'),
                edge('branch-to-false', 'branch', 'false-log', 'false'),
            ],
        );

    it('runs only the true branch when the condition matches', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(branchPipeline('pdf'), bus);

        const messages = events
            .filter((event) => event.name === 'log.output')
            .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
        expect(messages).toEqual(['took the TRUE branch']);
    });

    it('runs only the false branch when the condition does not match', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(branchPipeline('png'), bus);

        const messages = events
            .filter((event) => event.name === 'log.output')
            .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
        expect(messages).toEqual(['took the FALSE branch']);
    });
});

describe('executePipeline — switch branching', () => {
    const switchPipeline = (cases: readonly string[]): CompiledPipeline =>
        pipeline(
            [
                trigger(),
                {
                    id: 'sw',
                    type: 'switch',
                    config: { target: 'event', field: 'ext', cases: [...cases] },
                },
                log('pdf-log', 'routed to PDF'),
                log('png-log', 'routed to PNG'),
                log('default-log', 'routed to DEFAULT'),
            ],
            [
                edge('t-to-sw', 'trigger', 'sw', 'out'),
                edge('sw-to-pdf', 'sw', 'pdf-log', 'pdf'),
                edge('sw-to-png', 'sw', 'png-log', 'png'),
                edge('sw-to-default', 'sw', 'default-log', 'default'),
            ],
        );

    it('routes to the matching case port', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(switchPipeline(['pdf', 'png']), bus);

        const messages = events
            .filter((event) => event.name === 'log.output')
            .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
        expect(messages).toEqual(['routed to PDF']);
    });

    it('falls through to the default port when no case matches', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(switchPipeline(['jpg', 'png']), bus);

        const messages = events
            .filter((event) => event.name === 'log.output')
            .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
        expect(messages).toEqual(['routed to DEFAULT']);
    });
});

describe('executePipeline — fan-out', () => {
    it('schedules every downstream node on a single output port, in topological order', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(
            pipeline(
                [trigger(), log('log-a', 'A'), log('log-b', 'B'), log('log-c', 'C')],
                [
                    edge('t-to-a', 'trigger', 'log-a', 'out'),
                    edge('t-to-b', 'trigger', 'log-b', 'out'),
                    edge('a-to-c', 'log-a', 'log-c', 'out'),
                ],
            ),
            bus,
        );

        const messages = events
            .filter((event) => event.name === 'log.output')
            .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
        expect(messages).toEqual(['A', 'B', 'C']);
    });
});

describe('executePipeline — delay', () => {
    it('awaits the configured delay before continuing', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);
        const sleepCalls: number[] = [];
        const fakeSleep = (ms: number): Promise<void> => {
            sleepCalls.push(ms);
            return Promise.resolve();
        };

        await executePipeline(
            pipeline(
                [
                    trigger(),
                    { id: 'wait', type: 'delay', config: { ms: 50 } },
                    log('after', 'ran after delay'),
                ],
                [
                    edge('t-to-wait', 'trigger', 'wait', 'out'),
                    edge('wait-to-after', 'wait', 'after', 'out'),
                ],
            ),
            bus,
            undefined,
            fakeSleep,
        );

        expect(sleepCalls).toEqual([50]);
        expect(events.map((event) => event.name)).toEqual([
            'workflow.started',
            'manual.trigger.fired',
            'log.output',
            'workflow.completed',
        ]);
    });
});

describe('executePipeline — notification', () => {
    it('emits a notification.show event with interpolated title and body', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(
            pipeline(
                [
                    trigger(),
                    {
                        id: 'notify',
                        type: 'notification',
                        config: {
                            title: 'Sorted {{event.name}}',
                            body: 'Moved {{event.size}} bytes',
                        },
                    },
                ],
                [edge('t-to-notify', 'trigger', 'notify', 'out')],
            ),
            bus,
        );

        const notificationEvent = events.find((event) => event.name === 'notification.show');
        expect(notificationEvent).toBeDefined();
        expect(
            notificationEvent?.name === 'notification.show' && notificationEvent.payload,
        ).toEqual({ title: 'Sorted report.pdf', body: 'Moved 2048576 bytes' });
    });
});

describe('executePipeline — context pass-through', () => {
    it('carries the event context through if-else and delay unchanged to a downstream log', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);
        const fakeSleep = (): Promise<void> => Promise.resolve();

        await executePipeline(
            pipeline(
                [
                    trigger(),
                    {
                        id: 'branch',
                        type: 'if-else',
                        config: {
                            condition: {
                                target: 'event',
                                field: 'ext',
                                operator: 'equals',
                                value: 'pdf',
                            },
                        },
                    },
                    { id: 'wait', type: 'delay', config: { ms: 1 } },
                    log('final', 'file is {{event.name}} ({{event.ext}})'),
                ],
                [
                    edge('t-to-branch', 'trigger', 'branch', 'out'),
                    edge('branch-to-wait', 'branch', 'wait', 'true'),
                    edge('wait-to-final', 'wait', 'final', 'out'),
                ],
            ),
            bus,
            undefined,
            fakeSleep,
        );

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'file is report.pdf (pdf)',
        );
    });
});

describe('executePipeline — error handling', () => {
    const errorPipeline = (): CompiledPipeline =>
        pipeline(
            [
                trigger(),
                { id: 'wait', type: 'delay', config: { ms: 50 } },
                log('after', 'should not run'),
            ],
            [
                edge('t-to-wait', 'trigger', 'wait', 'out'),
                edge('wait-to-after', 'wait', 'after', 'out'),
            ],
        );

    const failingSleep = (): Promise<void> => Promise.reject(new Error('delay failed'));

    it('fires a workflow.error event and stops gracefully when a node throws', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        await executePipeline(errorPipeline(), bus, undefined, failingSleep);

        const errorEvent = events.find((event) => event.name === 'workflow.error');
        expect(errorEvent).toBeDefined();
        expect(errorEvent?.name === 'workflow.error' && errorEvent.payload.nodeId).toBe('wait');

        expect(
            events.some(
                (event) =>
                    event.name === 'log.output' && event.payload.message === 'should not run',
            ),
        ).toBe(false);
        expect(events[events.length - 1]?.name).toBe('workflow.completed');
    });

    it('emits a default error notification when notifyOnWorkflowError is true', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);
        const settings: ExecutorSettings = { notifyOnWorkflowError: true };

        await executePipeline(errorPipeline(), bus, settings, failingSleep);

        const notificationEvent = events.find((event) => event.name === 'notification.show');
        expect(notificationEvent).toBeDefined();
    });

    it('suppresses the error notification when notifyOnWorkflowError is false', async () => {
        const bus = createEventBus();
        const events = captureEvents(bus);
        const settings: ExecutorSettings = { notifyOnWorkflowError: false };

        await executePipeline(errorPipeline(), bus, settings, failingSleep);

        expect(events.some((event) => event.name === 'notification.show')).toBe(false);
        expect(events.some((event) => event.name === 'workflow.error')).toBe(true);
    });
});
