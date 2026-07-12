import type { PipelineNode } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { describe, expect, it, vi } from 'vitest';

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

const delayNode: PipelineNode = {
    id: 'wait',
    type: 'delay',
    config: { ms: 50 },
};

function buildDeps(overrides?: Partial<NodeHandlerDeps>): NodeHandlerDeps {
    return {
        bus: createEventBus(),
        sleep: vi.fn(),
        resolveTemplate: vi.fn(),
        evaluateCondition: vi.fn(),
        matchSwitchCase: vi.fn(),
        state: { get: vi.fn(), set: vi.fn(), flush: vi.fn() },
        capabilityBroker: { request: vi.fn() },
        ...overrides,
    };
}

describe('delay handler', () => {
    it('calls sleep with the configured ms and passes the context through', async () => {
        const sleep = vi.fn().mockResolvedValue(undefined as never);
        const deps = { ...buildDeps(), sleep };

        const { delayHandler } = await import('./delay.js');
        const result = await delayHandler.execute({ node: delayNode, ctx }, deps);

        expect(result.activePort).toBe('out');
        expect(result.outputCtx).toBe(ctx);
        expect(sleep).toHaveBeenCalledWith(50, undefined);
    });
});
