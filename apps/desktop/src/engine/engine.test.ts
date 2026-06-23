import { describe, expect, it } from 'vitest';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import type { BusEvent } from './event-bus.js';
import { createEngine } from './engine.js';

describe('createEngine', () => {
    it('exposes the event bus, stub bridge, and stub capability broker', () => {
        const engine = createEngine();

        expect(engine.bus).toBeDefined();
        expect(engine.bridge).toBeDefined();
        expect(engine.capabilityBroker).toBeDefined();
    });

    it('runs the sample pipeline through execute and emits log.output on the bus', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });

        await engine.execute(sampleManualTriggerToLog);

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent).toBeDefined();
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'Manual trigger fired for report.pdf (2048576 bytes)',
        );
    });

    it('defaults notifyOnWorkflowError to true when no properties are provided', () => {
        const engine = createEngine();
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });

    it('reads notifyOnWorkflowError from the provided properties file content', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: false } });
        expect(engine.settings.notifyOnWorkflowError).toBe(false);
    });

    it('falls back to the hardcoded default when the properties content is malformed', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: 'not-a-boolean' } });
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });
});
