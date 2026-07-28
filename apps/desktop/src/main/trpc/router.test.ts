import { describe, expect, it, vi } from 'vitest';
import type { WorkflowSummary } from '../../shared/workflow.js';
import type { EngineHandle } from '../engine-client.js';
import { createAppRouter } from './router.js';

function createRouter(engine: EngineHandle | null, workflows: readonly WorkflowSummary[] = []) {
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
        await expect(caller.getWorkflow({ id: 'workflow-1' })).resolves.toBeNull();
        await expect(caller.listPlugins()).resolves.toEqual([]);
        await expect(caller.readProperties()).resolves.toEqual({ properties: {}, defaults: {} });
        await expect(caller.readWorkflowState({ id: 'workflow-1' })).resolves.toEqual([]);
    });

    it('propagates read failures from the Engine through tRPC', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const engine = {
            getWorkflow: vi.fn().mockRejectedValue(new Error('workflow read failed')),
            listPlugins: vi.fn().mockRejectedValue(new Error('plugin read failed')),
            readProperties: vi.fn().mockRejectedValue(new Error('properties read failed')),
            readWorkflowState: vi.fn().mockRejectedValue(new Error('state read failed')),
        } as unknown as EngineHandle;
        const caller = createRouter(engine).createCaller({});

        try {
            await expect(caller.getWorkflow({ id: 'workflow-1' })).rejects.toThrow(
                'workflow read failed',
            );
            await expect(caller.listPlugins()).rejects.toThrow('plugin read failed');
            await expect(caller.readProperties()).rejects.toThrow('properties read failed');
            await expect(caller.readWorkflowState({ id: 'workflow-1' })).rejects.toThrow(
                'state read failed',
            );
        } finally {
            consoleError.mockRestore();
        }
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
            document: {
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

    it('reports a missing Engine through every subscription error channel', async () => {
        const caller = createRouter(null).createCaller({});
        const subscriptions = [
            await caller.onEngineLog(),
            await caller.onWorkflowsList(),
            await caller.onBusEvent(),
        ];

        for (const observable of subscriptions) {
            const error = vi.fn();
            observable.subscribe({ error });
            expect(error).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Engine not ready' }),
            );
        }
    });

    it('emits the current workflow list and tears down the Engine subscription', async () => {
        const workflows: readonly WorkflowSummary[] = [
            {
                id: 'workflow-1',
                name: 'Workflow 1',
                enabled: false,
                activation: { kind: 'disabled' },
            },
        ];
        let emitWorkflows: ((next: readonly WorkflowSummary[]) => void) | undefined;
        const unsubscribe = vi.fn();
        const engine = {
            onWorkflowsList: (handler: (next: readonly WorkflowSummary[]) => void) => {
                emitWorkflows = handler;
                return unsubscribe;
            },
        } as unknown as EngineHandle;
        const caller = createRouter(engine, workflows).createCaller({});
        const received: (readonly WorkflowSummary[])[] = [];
        const observable = await caller.onWorkflowsList();
        const subscription = observable.subscribe({
            next: (next) => received.push(next),
        });

        expect(received).toEqual([workflows]);
        emitWorkflows?.([
            {
                ...workflows[0],
                enabled: true,
                activation: { kind: 'activating' },
            },
        ]);
        expect(received).toHaveLength(2);
        subscription.unsubscribe();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
