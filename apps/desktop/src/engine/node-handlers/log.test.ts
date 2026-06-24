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

const logNode: PipelineNode = {
    id: 'log',
    type: 'log',
    config: { message: 'File {{payload.name}} arrived' },
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

describe('log handler', () => {
    it('resolves the message template and emits a log.output event', async () => {
        const resolveTemplate = vi.fn().mockReturnValue('File report.pdf arrived');
        const bus = createEventBus();
        const events: { name: string; payload: unknown }[] = [];
        bus.subscribe((event) => events.push(event));
        const deps = { ...buildDeps(), bus, resolveTemplate };

        const { logHandler } = await import('./log.js');
        const result = await logHandler.execute({ node: logNode, ctx }, deps);

        expect(result.activePort).toBe('out');
        expect(result.outputCtx).toBe(ctx);
        expect(resolveTemplate).toHaveBeenCalledWith('File {{payload.name}} arrived', ctx);
        expect(events).toEqual([
            { name: 'log.output', payload: { message: 'File report.pdf arrived' } },
        ]);
    });
});
