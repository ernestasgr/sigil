import { describe, expect, it, vi } from 'vitest';

import type { PipelineNode } from '@sigil/schema/nodes';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { BusEvent } from '../event-bus.js';
import { createEventBus } from '../event-bus.js';
import type { NodeHandlerDeps } from './types.js';

const payload: FileEventPayload = {
    path: '/Users/dev/Downloads/report.pdf',
    name: 'report.pdf',
    ext: 'pdf',
    size: 2048576,
    dir: '/Users/dev/Downloads',
};

const triggerNode: PipelineNode = {
    id: 'trigger',
    type: 'manual-trigger',
    config: { eventName: 'file.created', payload },
};

function buildDeps(): NodeHandlerDeps {
    const bus = createEventBus();
    return {
        bus,
        sleep: vi.fn(),
        resolveTemplate: vi.fn(),
        evaluateCondition: vi.fn(),
        matchSwitchCase: vi.fn(),
        state: { get: vi.fn(), set: vi.fn(), flush: vi.fn() },
    };
}

function emittedEvents(bus: ReturnType<typeof createEventBus>): BusEvent[] {
    const events: BusEvent[] = [];
    bus.subscribe((event) => events.push(event));
    return events;
}

describe('manual-trigger handler', () => {
    it('produces the initial workflow context from the node config', async () => {
        const { manualTriggerHandler } = await import('./manual-trigger.js');
        const deps = buildDeps();
        const events = emittedEvents(deps.bus);

        const result = await manualTriggerHandler.execute(
            { node: triggerNode, ctx: { event: '', payload: {}, vars: {} } },
            deps,
        );

        expect(result.outputCtx).toEqual({
            event: 'file.created',
            payload,
            vars: {},
        });
        expect(result.activePort).toBe('out');
        expect(events).toEqual([{ name: 'manual.trigger.fired', payload }]);
    });
});
