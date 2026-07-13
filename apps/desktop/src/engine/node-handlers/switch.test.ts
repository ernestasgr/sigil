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

const switchNode: PipelineNode = {
    id: 'sw',
    type: 'switch',
    config: {
        target: 'event',
        cases: [
            { id: 'case-created', value: 'file.created' },
            { id: 'case-deleted', value: 'file.deleted' },
        ],
    },
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

describe('switch handler', () => {
    it('returns the active port from matchSwitchCase', async () => {
        const matchSwitchCase = vi.fn().mockReturnValue('case-created');
        const deps = { ...buildDeps(), matchSwitchCase };

        const { switchHandler } = await import('./switch.js');
        const result = await switchHandler.execute({ node: switchNode, ctx }, deps);

        expect(result.activePort).toBe('case-created');
        expect(result.outputCtx).toBe(ctx);
        expect(matchSwitchCase).toHaveBeenCalledWith(switchNode.config, ctx);
    });

    it('returns default port when no case matches', async () => {
        const matchSwitchCase = vi.fn().mockReturnValue('default');
        const deps = { ...buildDeps(), matchSwitchCase };

        const { switchHandler } = await import('./switch.js');
        const result = await switchHandler.execute({ node: switchNode, ctx }, deps);

        expect(result.activePort).toBe('default');
        expect(result.outputCtx).toBe(ctx);
    });
});
