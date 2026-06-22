import { describe, expect, it } from 'vitest';

import { createEventBus } from './event-bus.js';

describe('createEventBus', () => {
    it('delivers emitted events to subscribers', () => {
        const bus = createEventBus();
        const received: string[] = [];
        bus.subscribe((event) => {
            received.push(event.name);
        });

        bus.next({
            name: 'log.output',
            payload: { message: 'Manual trigger fired for report.pdf' },
        });

        expect(received).toEqual(['log.output']);
    });

    it('carries the typed payload through to the subscriber', () => {
        const bus = createEventBus();
        let captured: unknown = null;
        bus.subscribe((event) => {
            if (event.name === 'log.output') {
                captured = event.payload;
            }
        });

        bus.next({ name: 'log.output', payload: { message: 'hello sigil' } });

        expect(captured).toEqual({ message: 'hello sigil' });
    });
});
