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
    vars: { existing: 'keep-me' },
};

const stateGetNode: PipelineNode = {
    id: 'get-counter',
    type: 'state-get',
    config: { key: 'counter', assignTo: 'counter' },
};

function buildDeps(): NodeHandlerDeps {
    return {
        bus: createEventBus(),
        sleep: vi.fn(),
        resolveTemplate: vi.fn(),
        evaluateCondition: vi.fn(),
        matchSwitchCase: vi.fn(),
        state: { get: vi.fn(), set: vi.fn(), flush: vi.fn() },
        capabilityBroker: { request: vi.fn() },
        pluginId: 'com.sigil.file-manager',
        collisionSuffixStyle: 'windows',
    };
}

describe('state-get handler', () => {
    it('reads the key from state and assigns it to vars[assignTo]', async () => {
        const state = { ...buildDeps().state, get: vi.fn().mockReturnValue('42') };
        const deps = { ...buildDeps(), state };

        const { stateGetHandler } = await import('./state-get.js');
        const result = await stateGetHandler.execute({ node: stateGetNode, ctx }, deps);

        expect(state.get).toHaveBeenCalledWith('counter');
        expect(result.activePort).toBe('out');
        expect(result.outputCtx.vars['counter']).toBe('42');
    });

    it('preserves the original payload metadata and existing vars', async () => {
        const state = { ...buildDeps().state, get: vi.fn().mockReturnValue('42') };
        const deps = { ...buildDeps(), state };

        const { stateGetHandler } = await import('./state-get.js');
        const result = await stateGetHandler.execute({ node: stateGetNode, ctx }, deps);

        expect(result.outputCtx.event).toBe('file.created');
        expect(result.outputCtx.payload).toEqual(ctx.payload);
        expect(result.outputCtx.vars['existing']).toBe('keep-me');
    });

    it('produces a new context rather than mutating the input', async () => {
        const state = { ...buildDeps().state, get: vi.fn().mockReturnValue('42') };
        const deps = { ...buildDeps(), state };

        const { stateGetHandler } = await import('./state-get.js');
        const result = await stateGetHandler.execute({ node: stateGetNode, ctx }, deps);

        expect(result.outputCtx).not.toBe(ctx);
        expect(result.outputCtx.vars).not.toBe(ctx.vars);
        expect(ctx.vars['counter']).toBeUndefined();
    });

    it('assigns undefined when the key is missing without dropping other vars', async () => {
        const state = { ...buildDeps().state, get: vi.fn().mockReturnValue(undefined) };
        const deps = { ...buildDeps(), state };

        const { stateGetHandler } = await import('./state-get.js');
        const result = await stateGetHandler.execute({ node: stateGetNode, ctx }, deps);

        expect(result.outputCtx.vars['counter']).toBeUndefined();
        expect(result.outputCtx.vars['existing']).toBe('keep-me');
    });
});
