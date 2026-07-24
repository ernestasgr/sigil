import { describe, expect, it, vi } from 'vitest';

import type { EngineHandle } from '../engine-client.js';
import { createAppRouter } from './router.js';

function createRouter(engine: EngineHandle | null, workflows: readonly [] = []) {
    return createAppRouter({
        getEngine: () => engine,
        getMainWindow: () => null,
        getWorkflows: () => workflows,
    });
}

describe('AppRouter', () => {
    it('keeps Engine-not-ready responses inside the typed outcome contract', async () => {
        const caller = createRouter(null).createCaller({});

        await expect(caller.fireTestEvent()).resolves.toEqual({
            ok: false,
            error: 'Engine not ready',
        });
        await expect(caller.toggleWorkflow({ id: 'workflow-1' })).resolves.toEqual({
            ok: false,
            error: 'Engine not ready',
            diagnostics: [],
        });
        await expect(caller.listPlugins()).resolves.toEqual([]);
    });

    it('passes named tRPC input through to the Engine seam', async () => {
        const createWorkflow = vi.fn().mockResolvedValue({
            ok: false,
            error: 'invalid workflow',
            diagnostics: [],
        });
        const engine = { createWorkflow } as unknown as EngineHandle;
        const caller = createRouter(engine).createCaller({});
        const input = {
            name: 'Fixture workflow',
            pipeline: {
                id: 'pipeline-1',
                workflowId: 'workflow-1',
                schemaVersion: 1 as const,
                nodes: [],
                edges: [],
            },
            positions: {},
        };

        await expect(caller.createWorkflow(input)).resolves.toEqual({
            ok: false,
            error: 'invalid workflow',
            diagnostics: [],
        });
        expect(createWorkflow).toHaveBeenCalledWith(input);
    });

    it('tears down Engine subscriptions when the renderer unsubscribes', async () => {
        let emitLog: ((line: string) => void) | undefined;
        const unsubscribe = vi.fn();
        const engine = {
            onLog: (handler: (line: string) => void) => {
                emitLog = handler;
                return unsubscribe;
            },
        } as unknown as EngineHandle;
        const caller = createRouter(engine).createCaller({});
        const received: string[] = [];
        const observable = await caller.onEngineLog();
        const subscription = observable.subscribe({
            next: (line) => received.push(line),
        });

        emitLog?.('from Engine');
        expect(received).toEqual(['from Engine']);
        subscription.unsubscribe();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
