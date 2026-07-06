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

function node(ext: string): PipelineNode {
    return {
        id: 'branch',
        type: 'if-else',
        config: {
            condition: {
                target: 'payload',
                field: 'ext',
                operator: 'equals',
                value: ext,
            },
        },
    };
}

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

describe('if-else handler', () => {
    it('returns true port when condition matches', async () => {
        const evaluateCondition = vi.fn().mockReturnValue(true);
        const deps = { ...buildDeps(), evaluateCondition };

        const { ifElseHandler } = await import('./if-else.js');
        const result = await ifElseHandler.execute({ node: node('pdf'), ctx }, deps);

        expect(result.activePort).toBe('true');
        expect(result.outputCtx).toBe(ctx);
        expect(evaluateCondition).toHaveBeenCalledWith(
            { target: 'payload', field: 'ext', operator: 'equals', value: 'pdf' },
            ctx,
        );
    });

    it('returns false port when condition does not match', async () => {
        const evaluateCondition = vi.fn().mockReturnValue(false);
        const deps = { ...buildDeps(), evaluateCondition };

        const { ifElseHandler } = await import('./if-else.js');
        const result = await ifElseHandler.execute({ node: node('png'), ctx }, deps);

        expect(result.activePort).toBe('false');
        expect(result.outputCtx).toBe(ctx);
    });
});
