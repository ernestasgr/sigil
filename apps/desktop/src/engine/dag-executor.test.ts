import { describe, expect, it } from 'vitest';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { executePipeline } from './dag-executor.js';

function captureEvents(bus: ReturnType<typeof createEventBus>): BusEvent[] {
    const events: BusEvent[] = [];
    bus.subscribe((event) => {
        events.push(event);
    });
    return events;
}

describe('executePipeline', () => {
    it('emits a log.output event with the rendered sample message', () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        executePipeline(sampleManualTriggerToLog, bus);

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent).toBeDefined();
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'Manual trigger fired for report.pdf (2048576 bytes)',
        );
    });

    it('emits workflow lifecycle and trigger events in order', () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        executePipeline(sampleManualTriggerToLog, bus);

        expect(events.map((event) => event.name)).toEqual([
            'workflow.started',
            'manual.trigger.fired',
            'log.output',
            'workflow.completed',
        ]);
    });

    it('fires the manual trigger with the payload from the node config', () => {
        const bus = createEventBus();
        const events = captureEvents(bus);

        executePipeline(sampleManualTriggerToLog, bus);

        const triggerEvent = events.find((event) => event.name === 'manual.trigger.fired');
        expect(triggerEvent?.name === 'manual.trigger.fired' && triggerEvent.payload).toEqual({
            path: '/Users/dev/Downloads/report.pdf',
            name: 'report.pdf',
            ext: 'pdf',
            size: 2048576,
            dir: '/Users/dev/Downloads',
        });
    });
});
