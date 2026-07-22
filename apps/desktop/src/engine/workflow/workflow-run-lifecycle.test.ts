import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import {
    type NodeContractRegistry,
    pluginNodeIdentity,
    registerSerializableNodeContract,
} from '@sigil/schema/node-contract';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { EngineChannel } from '../../shared/ipc-channels.js';
import { type DispatchSubsystems, dispatch } from '../core/dispatch.js';
import { createEngine } from '../core/engine.js';
import type { NodeRunResult, TriggerHandler } from '../node-handlers/types.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowLifecycle } from './workflow-lifecycle.js';
import { createWorkflowStore } from './workflow-store.js';

const context: WorkflowContext = {
    event: 'file.created',
    payload: { name: 'burst.txt' },
    vars: {},
};

function testPipeline(): CompiledPipeline {
    return {
        id: 'pipeline-run-lifecycle',
        workflowId: 'workflow-run-lifecycle',
        schemaVersion: 1,
        nodes: [
            {
                id: 'trigger',
                type: 'test-trigger',
                pluginId: 'com.sigil.test-trigger',
                config: {},
            },
        ],
        edges: [],
    };
}

function registerTestTriggerContract(contractRegistry: NodeContractRegistry): void {
    registerSerializableNodeContract(contractRegistry, {
        identity: pluginNodeIdentity('com.sigil.test-trigger', 'test-trigger'),
        version: 1,
        role: 'trigger',
        defaultConfig: {},
        outputPorts: {
            kind: 'fixed',
            ports: [{ id: 'out', label: 'Output' }],
        },
        display: {
            label: 'Test Trigger',
            description: 'Test trigger for workflow run lifecycle coverage.',
            category: 'trigger',
        },
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

interface RunFixture {
    readonly storageDir: string;
    readonly engine: ReturnType<typeof createEngine>;
    readonly store: ReturnType<typeof createWorkflowStore>;
    readonly activator: ReturnType<typeof createWorkflowActivator>;
    readonly lifecycle: ReturnType<typeof createWorkflowLifecycle>;
    readonly workflowId: string;
    readonly callbacks: readonly ((ctx: WorkflowContext) => void)[];
    readonly releases: readonly (() => void)[];
    readonly teardown: ReturnType<typeof vi.fn>;
    readonly getMaxActive: () => number;
    readonly dispose: () => void;
}

function createRunFixture(cancelOnAbort: boolean, queueLimit = 1): RunFixture {
    const storageDir = mkdtempSync(join(tmpdir(), 'sigil-workflow-run-lifecycle-'));
    const engine = createEngine();
    const callbacks: Array<(ctx: WorkflowContext) => void> = [];
    const releases: Array<() => void> = [];
    const teardown = vi.fn(() => {});
    let active = 0;
    let maxActive = 0;

    const handler: TriggerHandler = {
        activate: (_config, onEvent) => {
            callbacks.push(onEvent);
            return teardown;
        },
        execute: async ({ ctx }, deps): Promise<NodeRunResult> =>
            new Promise<NodeRunResult>((resolve) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                let settled = false;
                const finish = (): void => {
                    if (settled) return;
                    settled = true;
                    active -= 1;
                    deps.signal?.removeEventListener('abort', finish);
                    resolve({ outputCtx: ctx, activePort: 'out' });
                };
                releases.push(finish);
                if (cancelOnAbort) {
                    deps.signal?.addEventListener('abort', finish, { once: true });
                }
            }),
    };
    engine.handlerRegistry.register('test-trigger', handler);
    registerTestTriggerContract(engine.contractRegistry);

    const store = createWorkflowStore(
        storageDir,
        workflowTopologyOptions(engine.handlerRegistry, engine.contractRegistry),
    );
    const workflowId = store.create('Run Lifecycle Workflow', testPipeline(), {}).id;
    const activator = createWorkflowActivator(engine, store, engine.handlerRegistry, undefined, {
        runPolicy: { queueLimit },
    });
    const lifecycle = createWorkflowLifecycle(store, activator);

    return {
        storageDir,
        engine,
        store,
        activator,
        lifecycle,
        workflowId,
        callbacks,
        releases,
        teardown,
        getMaxActive: () => maxActive,
        dispose: () => {
            activator.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        },
    };
}

describe('Workflow run lifecycle supervision', () => {
    it('serializes bursts, exposes queue/drop outcomes, and never overlaps runs', async () => {
        const fixture = createRunFixture(true);
        const events: Array<{ readonly name: string; readonly payload: unknown }> = [];
        fixture.engine.bus.subscribe((event) => events.push(event));

        try {
            fixture.lifecycle.enable(fixture.workflowId);
            const callback = fixture.callbacks[0];
            if (!callback) throw new Error('Trigger callback was not registered');

            callback(context);
            callback(context);
            callback(context);

            expect(fixture.releases).toHaveLength(1);
            expect(events.filter((event) => event.name === 'workflow.queued')).toHaveLength(1);
            expect(events.filter((event) => event.name === 'workflow.dropped')).toHaveLength(1);
            expect(fixture.getMaxActive()).toBe(1);

            const firstRelease = fixture.releases[0];
            if (!firstRelease) throw new Error('First run release was not registered');
            firstRelease();
            await vi.waitFor(() => expect(fixture.releases).toHaveLength(2));
            expect(fixture.getMaxActive()).toBe(1);

            const secondRelease = fixture.releases[1];
            if (!secondRelease) throw new Error('Second run release was not registered');
            secondRelease();
            await fixture.activator.waitForRuns(fixture.workflowId);

            const completed = events.filter((event) => event.name === 'workflow.completed');
            expect(completed).toHaveLength(2);
            expect(
                completed.every((event) => isRecord(event.payload) && 'outcome' in event.payload),
            ).toBe(true);
        } finally {
            fixture.dispose();
        }
    });

    it('disables admission, cancels the active run, and drops later Trigger Events', async () => {
        const fixture = createRunFixture(true);
        const events: Array<{ readonly name: string; readonly payload: unknown }> = [];
        fixture.engine.bus.subscribe((event) => events.push(event));

        try {
            fixture.lifecycle.enable(fixture.workflowId);
            const callback = fixture.callbacks[0];
            if (!callback) throw new Error('Trigger callback was not registered');
            callback(context);
            expect(fixture.releases).toHaveLength(1);

            fixture.lifecycle.disable(fixture.workflowId);
            await fixture.activator.waitForRuns(fixture.workflowId);
            callback(context);

            expect(fixture.teardown).toHaveBeenCalledTimes(1);
            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'workflow.cancelled',
                        payload: expect.objectContaining({ phase: 'running' }),
                    }),
                    expect.objectContaining({
                        name: 'workflow.dropped',
                        payload: expect.objectContaining({ reason: 'not_accepting' }),
                    }),
                ]),
            );
            expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
                Option.some({ enabled: false, activation: { kind: 'disabled' } }),
            );
        } finally {
            fixture.dispose();
        }
    });

    it('drains cancelled work when disable persistence needs compensation', async () => {
        const fixture = createRunFixture(true);

        try {
            fixture.lifecycle.enable(fixture.workflowId);
            const callback = fixture.callbacks[0];
            if (!callback) throw new Error('Trigger callback was not registered');
            callback(context);
            expect(fixture.releases).toHaveLength(1);

            const persistenceError = new Error('disable persistence failed');
            vi.spyOn(fixture.store, 'setEnabled').mockImplementationOnce(() => {
                throw persistenceError;
            });

            expect(() => fixture.lifecycle.disable(fixture.workflowId)).toThrow(persistenceError);
            expect(fixture.activator.activeWorkflowIds()).toEqual([fixture.workflowId]);

            await fixture.activator.waitForRuns(fixture.workflowId);

            expect(fixture.activator.hasInFlightRuns(fixture.workflowId)).toBe(false);
            expect(fixture.teardown).toHaveBeenCalledTimes(1);
            expect(fixture.callbacks).toHaveLength(2);
        } finally {
            fixture.dispose();
        }
    });

    it('waits for a non-cooperative in-flight run before deleting the Workflow', async () => {
        const fixture = createRunFixture(false);
        const messages: unknown[] = [];

        try {
            fixture.lifecycle.enable(fixture.workflowId);
            const callback = fixture.callbacks[0];
            if (!callback) throw new Error('Trigger callback was not registered');
            callback(context);
            expect(fixture.releases).toHaveLength(1);

            const subsystems: DispatchSubsystems = {
                postMessage: (message) => messages.push(message),
                engine: fixture.engine,
                store: fixture.store,
                activator: fixture.activator,
                lifecycle: fixture.lifecycle,
                broadcastWorkflowsList: vi.fn(),
                log: vi.fn(),
                propertiesPath: '',
            };
            const deleting = dispatch(
                {
                    type: EngineChannel.DeleteWorkflow,
                    correlationId: 'delete-run-lifecycle',
                    id: fixture.workflowId,
                },
                subsystems,
            );

            expect(Option.isSome(fixture.store.getSummary(fixture.workflowId))).toBe(true);
            const release = fixture.releases[0];
            if (!release) throw new Error('Run release was not registered');
            release();
            await deleting;

            expect(Option.isNone(fixture.store.getSummary(fixture.workflowId))).toBe(true);
            expect(messages).toContainEqual({
                type: EngineChannel.DeleteWorkflowResult,
                correlationId: 'delete-run-lifecycle',
                success: true,
            });
        } finally {
            fixture.dispose();
        }
    });

    it('cleans up Workflow State when deleting the Workflow', async () => {
        const fixture = createRunFixture(true);
        const messages: unknown[] = [];

        try {
            fixture.engine.workflowStateStore.setKey(fixture.workflowId, 'remembered', 'value');

            const subsystems: DispatchSubsystems = {
                postMessage: (message) => messages.push(message),
                engine: fixture.engine,
                store: fixture.store,
                activator: fixture.activator,
                lifecycle: fixture.lifecycle,
                broadcastWorkflowsList: vi.fn(),
                log: vi.fn(),
                propertiesPath: '',
            };
            await dispatch(
                {
                    type: EngineChannel.DeleteWorkflow,
                    correlationId: 'delete-workflow-state',
                    id: fixture.workflowId,
                },
                subsystems,
            );

            expect(fixture.engine.workflowStateStore.listKeys(fixture.workflowId)).toEqual([]);
            expect(messages).toContainEqual({
                type: EngineChannel.DeleteWorkflowResult,
                correlationId: 'delete-workflow-state',
                success: true,
            });
        } finally {
            fixture.dispose();
        }
    });

    it('cancels admitted work and releases Workflow ownership before shutdown resolves', async () => {
        const fixture = createRunFixture(true, 1);
        const events: Array<{ readonly name: string; readonly payload: unknown }> = [];
        const messages: unknown[] = [];
        fixture.engine.bus.subscribe((event) => events.push(event));

        try {
            fixture.lifecycle.enable(fixture.workflowId);
            const callback = fixture.callbacks[0];
            if (!callback) throw new Error('Trigger callback was not registered');

            callback(context);
            callback(context);
            expect(fixture.releases).toHaveLength(1);

            const shutdown = dispatch(
                { type: EngineChannel.Shutdown, correlationId: 'shutdown-run-lifecycle' },
                {
                    postMessage: (message) => messages.push(message),
                    engine: fixture.engine,
                    store: fixture.store,
                    activator: fixture.activator,
                    lifecycle: fixture.lifecycle,
                    shutdown: async (): Promise<void> => {
                        fixture.activator.dispose();
                        await fixture.activator.waitForAllRuns();
                    },
                    broadcastWorkflowsList: vi.fn(),
                    log: vi.fn(),
                    propertiesPath: '',
                },
            );

            await shutdown;

            expect(messages).toContainEqual({
                type: EngineChannel.ShutdownResult,
                correlationId: 'shutdown-run-lifecycle',
                ok: true,
            });
            expect(fixture.activator.activeWorkflowIds()).toEqual([]);
            expect(fixture.activator.hasInFlightRuns(fixture.workflowId)).toBe(false);
            expect(fixture.teardown).toHaveBeenCalledTimes(1);
            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'workflow.cancelled',
                        payload: expect.objectContaining({ phase: 'running' }),
                    }),
                    expect.objectContaining({
                        name: 'workflow.cancelled',
                        payload: expect.objectContaining({ phase: 'queued' }),
                    }),
                ]),
            );

            callback(context);
            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'workflow.dropped',
                        payload: expect.objectContaining({ reason: 'not_accepting' }),
                    }),
                ]),
            );
        } finally {
            fixture.dispose();
        }
    });
});
