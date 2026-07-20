import { describe, expect, it } from 'vitest';

import {
    createEventBus,
    type LogOutputPayload,
    type NotificationShowPayload,
    type WorkflowErrorPayload,
} from './event-bus.js';

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
        let captured: LogOutputPayload | null = null;
        bus.subscribe((event) => {
            if (event.name === 'log.output') {
                captured = event.payload;
            }
        });

        bus.next({ name: 'log.output', payload: { message: 'hello sigil' } });

        expect(captured).toEqual({ message: 'hello sigil' });
    });

    it('carries a workflow.error payload through to the subscriber', () => {
        const bus = createEventBus();
        let captured: WorkflowErrorPayload | null = null;
        bus.subscribe((event) => {
            if (event.name === 'workflow.error') {
                captured = event.payload;
            }
        });

        bus.next({
            name: 'workflow.error',
            payload: { pipelineId: 'p1', nodeId: 'log', message: 'boom' },
        });

        expect(captured).toEqual({ pipelineId: 'p1', nodeId: 'log', message: 'boom' });
    });

    it('carries a notification.show payload through to the subscriber', () => {
        const bus = createEventBus();
        let captured: NotificationShowPayload | null = null;
        bus.subscribe((event) => {
            if (event.name === 'notification.show') {
                captured = event.payload;
            }
        });

        bus.next({
            name: 'notification.show',
            payload: { title: 'Sigil', body: 'Files sorted' },
        });

        expect(captured).toEqual({ title: 'Sigil', body: 'Files sorted' });
    });
});
