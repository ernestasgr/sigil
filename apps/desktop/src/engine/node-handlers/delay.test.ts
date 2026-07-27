import { MAX_DELAY_MS, type PipelineNode } from '@sigil/contracts/nodes';
import type { WorkflowContext } from '@sigil/contracts/workflow-context';
import { describe, expect, it, vi } from 'vitest';
import { testNode } from '../../test-support/pipeline-fixtures.js';
import { createEventBus } from '../events/event-bus.js';
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

const delayNode = (ms: number): PipelineNode =>
    testNode({
        id: 'wait',
        type: 'delay',
        config: { ms },
    });

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
    it.each([0, 1, 1_000, MAX_DELAY_MS])(
        'calls sleep with the admitted ms value %d and passes the context through',
        async (ms) => {
            const sleep = vi.fn().mockResolvedValue(undefined as never);
            const deps = { ...buildDeps(), sleep };

            const { delayHandler } = await import('./delay.js');
            const result = await delayHandler.execute({ node: delayNode(ms), ctx }, deps);

            expect(result.activePort).toBe('out');
            expect(result.outputCtx).toBe(ctx);
            expect(sleep).toHaveBeenCalledWith(ms, undefined);
        },
    );
});
