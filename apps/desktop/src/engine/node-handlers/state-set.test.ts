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
        ext: 'pdf',
        size: 2048576,
        dir: '/Users/dev/Downloads',
    },
    vars: { counter: '41' },
};

const stateSetNode: PipelineNode = {
    id: 'set-counter',
    type: 'state-set',
    config: { key: 'counter', valueTemplate: '{{event}}:{{payload.name}}' },
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

describe('state-set handler', () => {
    it('resolves the value template and writes the result to state under the configured key', async () => {
        const resolveTemplate = vi.fn().mockReturnValue('file.created:report.pdf');
        const state = { ...buildDeps().state, set: vi.fn() };
        const deps = { ...buildDeps(), resolveTemplate, state };

        const { stateSetHandler } = await import('./state-set.js');
        const result = await stateSetHandler.execute({ node: stateSetNode, ctx }, deps);

        expect(resolveTemplate).toHaveBeenCalledWith('{{event}}:{{payload.name}}', ctx);
        expect(state.set).toHaveBeenCalledWith('counter', 'file.created:report.pdf');
        expect(result.activePort).toBe('out');
    });

    it('passes the context through unchanged', async () => {
        const resolveTemplate = vi.fn().mockReturnValue('file.created:report.pdf');
        const deps = { ...buildDeps(), resolveTemplate };

        const { stateSetHandler } = await import('./state-set.js');
        const result = await stateSetHandler.execute({ node: stateSetNode, ctx }, deps);

        expect(result.outputCtx).toBe(ctx);
    });

    it('does not read from state', async () => {
        const resolveTemplate = vi.fn().mockReturnValue('file.created:report.pdf');
        const state = { ...buildDeps().state, get: vi.fn() };
        const deps = { ...buildDeps(), resolveTemplate, state };

        const { stateSetHandler } = await import('./state-set.js');
        await stateSetHandler.execute({ node: stateSetNode, ctx }, deps);

        expect(state.get).not.toHaveBeenCalled();
    });
});
