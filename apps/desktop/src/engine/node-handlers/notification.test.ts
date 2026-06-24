import { describe, expect, it, vi } from 'vitest';

import type { PipelineNode } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import { createEventBus } from '../event-bus.js';
import type { NodeHandlerDeps } from './types.js';

const ctx: WorkflowContext = {
    event: 'file.created',
    payload: {
        path: '/Users/dev/Downloads/report.pdf',
        name: 'report.pdf',
        ext: 'PDF',
        size: 2048576,
        dir: '/Users/dev/Downloads',
    },
    vars: {},
};

const notificationNode: PipelineNode = {
    id: 'notify',
    type: 'notification',
    config: { title: 'Sorted {{payload.name}}', body: 'Moved {{payload.size}} bytes' },
};

function buildDeps(): NodeHandlerDeps {
    return {
        bus: createEventBus(),
        sleep: vi.fn(),
        resolveTemplate: vi.fn(),
        evaluateCondition: vi.fn(),
        matchSwitchCase: vi.fn(),
    };
}

describe('notification handler', () => {
    it('resolves title and body templates and emits a notification.show event', async () => {
        const resolveTemplate = vi
            .fn()
            .mockReturnValueOnce('Sorted report.pdf')
            .mockReturnValueOnce('Moved 2048576 bytes');
        const bus = createEventBus();
        const events: { name: string; payload: unknown }[] = [];
        bus.subscribe((event) => events.push(event));
        const deps = { ...buildDeps(), bus, resolveTemplate };

        const { notificationHandler } = await import('./notification.js');
        const result = await notificationHandler.execute({ node: notificationNode, ctx }, deps);

        expect(result.activePort).toBe('out');
        expect(result.outputCtx).toBe(ctx);
        expect(resolveTemplate).toHaveBeenCalledTimes(2);
        expect(resolveTemplate).toHaveBeenCalledWith('Sorted {{payload.name}}', ctx);
        expect(resolveTemplate).toHaveBeenCalledWith('Moved {{payload.size}} bytes', ctx);
        expect(events).toEqual([
            {
                name: 'notification.show',
                payload: { title: 'Sorted report.pdf', body: 'Moved 2048576 bytes' },
            },
        ]);
    });
});
