import { describe, expect, it } from 'vitest';

import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createStubBridge } from './bridge.js';

describe('createStubBridge', () => {
    it('forwards emitted events onto the event bus', () => {
        const bus = createEventBus();
        const bridge = createStubBridge(bus);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        bridge.emit({ name: 'log.output', payload: { message: 'via bridge' } });

        expect(received).toHaveLength(1);
        expect(received[0]?.name).toBe('log.output');
    });
});
