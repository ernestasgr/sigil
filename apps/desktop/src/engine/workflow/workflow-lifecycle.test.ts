import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../core/engine.js';
import type { NodeRunResult, TriggerHandler } from '../node-handlers/types.js';
import type { AtomicWriteFailure } from '../persistence/atomic-file.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator, getDeactivationHook } from './workflow-activator.js';
import { createWorkflowLifecycle } from './workflow-lifecycle.js';
import { createWorkflowStore } from './workflow-store.js';

function testPipeline(pipelineId: string, workflowId: string): CompiledPipeline {
    return {
        id: pipelineId,
        workflowId,
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

function createFixture(activate: TriggerHandler['activate']): {
    readonly storageDir: string;
    readonly engine: ReturnType<typeof createEngine>;
    readonly store: ReturnType<typeof createWorkflowStore>;
    readonly activator: ReturnType<typeof createWorkflowActivator>;
    readonly lifecycle: ReturnType<typeof createWorkflowLifecycle>;
    readonly workflowId: string;
    readonly dispose: () => void;
} {
    const storageDir = mkdtempSync(join(tmpdir(), 'sigil-workflow-lifecycle-'));
    const engine = createEngine();
    const handler: TriggerHandler = {
        activate,
        execute: async ({ ctx }): Promise<NodeRunResult> => ({
            outputCtx: ctx,
            activePort: 'out',
        }),
    };
    engine.handlerRegistry.register('test-trigger', handler);
    const store = createWorkflowStore(storageDir, workflowTopologyOptions(engine.handlerRegistry));
    const activator = createWorkflowActivator(engine, store, engine.handlerRegistry);
    const lifecycle = createWorkflowLifecycle(store, activator);
    const workflowId = store.create(
        'Test Workflow',
        testPipeline('pipeline-1', 'workflow-1'),
        {},
    ).id;

    return {
        storageDir,
        engine,
        store,
        activator,
        lifecycle,
        workflowId,
        dispose: () => {
            activator.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        },
    };
}

describe('WorkflowLifecycle transitions', () => {
    const fixtures: Array<ReturnType<typeof createFixture>> = [];

    afterEach(() => {
        for (const fixture of fixtures.splice(0)) fixture.dispose();
    });

    it('enables intent only after a successful activation and reports live activation', () => {
        const teardown = vi.fn(() => {});
        const fixture = createFixture((_config, _onEvent) => teardown);
        fixtures.push(fixture);

        const result = fixture.lifecycle.enable(fixture.workflowId);

        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toMatchObject({
            id: fixture.workflowId,
            enabled: true,
            activation: { kind: 'active' },
        });
        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({ enabled: true, activation: { kind: 'active' } }),
        );
        expect(teardown).not.toHaveBeenCalled();
    });

    it('compensates a persistence failure after enable activation', () => {
        const teardown = vi.fn(() => {});
        const fixture = createFixture((_config, _onEvent) => teardown);
        fixtures.push(fixture);
        const persistenceError = new Error('enabled state could not be persisted');
        vi.spyOn(fixture.store, 'setEnabled').mockImplementationOnce(() => {
            throw persistenceError;
        });

        expect(() => fixture.lifecycle.enable(fixture.workflowId)).toThrow(persistenceError);

        expect(fixture.activator.isActive(fixture.workflowId)).toBe(false);
        expect(fixture.activator.activeWorkflowIds()).toEqual([]);
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({ enabled: false, activation: { kind: 'disabled' } }),
        );
    });

    it('cleans a partially registered activation when activation state persistence fails', () => {
        let onEvent: Parameters<TriggerHandler['activate']>[1] | undefined;
        const teardown = vi.fn(() => {});
        const fixture = createFixture((_config, callback) => {
            onEvent = callback;
            return teardown;
        });
        fixtures.push(fixture);
        const setActivation = fixture.store.setActivation;
        const persistenceError = new Error('active state could not be persisted');
        vi.spyOn(fixture.store, 'setActivation')
            .mockImplementationOnce(setActivation)
            .mockImplementationOnce(() => {
                throw persistenceError;
            });

        expect(fixture.activator.activate(fixture.workflowId)).toBe(false);

        expect(fixture.activator.isActive(fixture.workflowId)).toBe(false);
        expect(fixture.activator.activeWorkflowIds()).toEqual([]);
        expect(teardown).toHaveBeenCalledTimes(1);
        if (!onEvent) throw new Error('activation callback was not registered');
        expect(getDeactivationHook(onEvent)).toEqual(Option.none());
    });

    it('compensates a persistence failure after disable deactivation', () => {
        const teardowns: Array<ReturnType<typeof vi.fn>> = [];
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            const teardown = vi.fn(() => {});
            teardowns.push(teardown);
            return teardown;
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);
        const persistenceError = new Error('disabled state could not be persisted');
        vi.spyOn(fixture.store, 'setEnabled').mockImplementationOnce(() => {
            throw persistenceError;
        });

        expect(() => fixture.lifecycle.disable(fixture.workflowId)).toThrow(persistenceError);

        expect(fixture.activator.isActive(fixture.workflowId)).toBe(true);
        expect(fixture.activator.activeWorkflowIds()).toEqual([fixture.workflowId]);
        expect(teardowns[0]).toHaveBeenCalledTimes(1);
        expect(teardowns).toHaveLength(2);
        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({ enabled: true, activation: { kind: 'active' } }),
        );
    });

    it('preserves the primary error when persistence compensation also fails', () => {
        const fixture = createFixture(() => () => {});
        fixtures.push(fixture);
        const primaryDiagnostic: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: 'workflow-1.json',
            message: 'primary write failed',
        };
        const compensationDiagnostic: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: 'workflow-1.json',
            message: 'compensation write failed',
        };
        const primaryMetadata = Symbol('primaryMetadata');
        const primaryError = Object.assign(new Error('primary transition failure'), {
            kind: 'workflow_persistence' as const,
            operation: 'set_enabled' as const,
            workflowId: fixture.workflowId,
            diagnostic: primaryDiagnostic,
            diagnostics: [primaryDiagnostic],
        });
        Object.defineProperty(primaryError, primaryMetadata, {
            configurable: true,
            value: { source: 'primary' },
        });
        const compensationError = Object.assign(new Error('compensation transition failure'), {
            kind: 'workflow_persistence' as const,
            operation: 'set_enabled' as const,
            workflowId: fixture.workflowId,
            diagnostic: compensationDiagnostic,
            diagnostics: [compensationDiagnostic],
        });
        vi.spyOn(fixture.store, 'setEnabled')
            .mockImplementationOnce(() => {
                throw primaryError;
            })
            .mockImplementationOnce(() => {
                throw compensationError;
            });

        let caught: unknown;
        try {
            fixture.lifecycle.enable(fixture.workflowId);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBe(primaryError);
        expect(caught).toMatchObject({ cause: primaryError });
        expect(primaryError.message).toBe('primary transition failure');
        expect(primaryError.diagnostics).toEqual([primaryDiagnostic]);
        expect(Object.getOwnPropertyDescriptor(caught as Error, primaryMetadata)?.value).toEqual({
            source: 'primary',
        });
        expect(caught).toMatchObject({
            diagnostics: [primaryDiagnostic, compensationDiagnostic],
        });
        expect(caught).toMatchObject({
            message: expect.stringContaining('compensation transition failure'),
        });
    });

    it('defaults malformed persistence diagnostics during compensation', () => {
        const fixture = createFixture(() => () => {});
        fixtures.push(fixture);
        const diagnostic: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: 'workflow-1.json',
            message: 'write failed',
        };
        const primaryError = Object.assign(new Error('primary transition failure'), {
            kind: 'workflow_persistence' as const,
            operation: 'set_enabled' as const,
            workflowId: fixture.workflowId,
            diagnostic,
            diagnostics: 'malformed',
        });
        const compensationError = Object.assign(new Error('compensation transition failure'), {
            kind: 'workflow_persistence' as const,
            operation: 'set_enabled' as const,
            workflowId: fixture.workflowId,
            diagnostic,
            diagnostics: undefined,
        });
        vi.spyOn(fixture.store, 'setEnabled')
            .mockImplementationOnce(() => {
                throw primaryError;
            })
            .mockImplementationOnce(() => {
                throw compensationError;
            });

        let caught: unknown;
        try {
            fixture.lifecycle.enable(fixture.workflowId);
        } catch (error) {
            caught = error;
        }

        expect(caught).toMatchObject({ diagnostics: [] });
    });

    it('restores disabled intent with a failed activation state when activation throws', () => {
        const fixture = createFixture(() => {
            throw new Error('permission denied');
        });
        fixtures.push(fixture);
        const diagnostics: string[] = [];
        fixture.engine.bus.subscribe((event) => {
            if (event.name === 'engine.diagnostic') diagnostics.push(event.payload.message);
        });

        const result = fixture.lifecycle.enable(fixture.workflowId);

        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toMatchObject({
            enabled: false,
            activation: { kind: 'failed', message: 'permission denied' },
        });
        expect(
            JSON.parse(
                readFileSync(join(fixture.storageDir, `${fixture.workflowId}.json`), 'utf8'),
            ),
        ).toMatchObject({
            enabled: false,
            activation: { kind: 'failed', message: 'permission denied' },
        });
        expect(diagnostics).toEqual(
            expect.arrayContaining([expect.stringContaining('permission denied')]),
        );
    });

    it('records a later Trigger worker failure without clearing enabled intent', () => {
        let onEvent: Parameters<TriggerHandler['activate']>[1] | undefined;
        const teardown = vi.fn(() => {});
        const fixture = createFixture((_config, callback) => {
            onEvent = callback;
            return teardown;
        });
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);

        if (!onEvent) throw new Error('activation callback was not registered');
        const onWorkerFailure = Option.getOrThrow(getDeactivationHook(onEvent));
        onWorkerFailure('worker exploded');

        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({
                enabled: true,
                activation: { kind: 'failed', message: 'worker exploded' },
            }),
        );
        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('retries persisted enabled intent during startup and leaves a visible failure state', () => {
        const fixture = createFixture(() => {
            throw new Error('startup worker unavailable');
        });
        fixtures.push(fixture);
        expect(fixture.activator.activate(fixture.workflowId)).toBe(false);
        expect(Option.isSome(fixture.store.setEnabled(fixture.workflowId, true))).toBe(true);

        const reloadedStore = createWorkflowStore(
            fixture.storageDir,
            workflowTopologyOptions(fixture.engine.handlerRegistry),
        );
        const reloadedActivator = createWorkflowActivator(
            fixture.engine,
            reloadedStore,
            fixture.engine.handlerRegistry,
        );
        const reloadedLifecycle = createWorkflowLifecycle(reloadedStore, reloadedActivator);

        expect(reloadedStore.list()[0]).toMatchObject({
            enabled: true,
            activation: { kind: 'failed', message: 'startup worker unavailable' },
        });
        expect(reloadedLifecycle.activateEnabled(fixture.workflowId)).toMatchObject(
            Option.some({
                enabled: true,
                activation: { kind: 'failed', message: 'startup worker unavailable' },
            }),
        );

        reloadedActivator.dispose();
    });

    it('retries a failed activation through the same transition seam', () => {
        let shouldFail = true;
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            if (shouldFail) throw new Error('worker unavailable');
            return () => {};
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);

        const first = fixture.lifecycle.enable(fixture.workflowId);
        shouldFail = false;
        const second = fixture.lifecycle.retry(fixture.workflowId);

        expect(Option.getOrThrow(first)).toMatchObject({
            enabled: false,
            activation: { kind: 'failed' },
        });
        expect(Option.getOrThrow(second)).toMatchObject({
            enabled: true,
            activation: { kind: 'active' },
        });
        expect(activate).toHaveBeenCalledTimes(2);
    });

    it('disables intent and tears down a live activation', () => {
        const teardown = vi.fn(() => {});
        const fixture = createFixture((_config, _onEvent) => teardown);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);

        const result = fixture.lifecycle.disable(fixture.workflowId);

        expect(Option.getOrThrow(result)).toMatchObject({
            enabled: false,
            activation: { kind: 'disabled' },
        });
        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('updates an enabled Workflow by deactivating and reactivating it', () => {
        const teardowns: Array<ReturnType<typeof vi.fn>> = [];
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            const teardown = vi.fn(() => {});
            teardowns.push(teardown);
            return teardown;
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);

        const result = fixture.lifecycle.update(fixture.workflowId, () =>
            fixture.store.save(
                fixture.workflowId,
                'Updated Workflow',
                testPipeline('pipeline-2', 'workflow-1'),
                {},
            ),
        );

        expect(result).toMatchObject({
            name: 'Updated Workflow',
            enabled: true,
            activation: { kind: 'active' },
        });
        expect(activate).toHaveBeenCalledTimes(2);
        expect(teardowns[0]).toHaveBeenCalledTimes(1);
    });

    it('restores the previous active Workflow when update reactivation fails', () => {
        const teardowns: Array<ReturnType<typeof vi.fn>> = [];
        let activationCount = 0;
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            activationCount += 1;
            if (activationCount === 2) throw new Error('updated trigger unavailable');
            const teardown = vi.fn(() => {});
            teardowns.push(teardown);
            return teardown;
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);

        expect(() =>
            fixture.lifecycle.update(fixture.workflowId, () =>
                fixture.store.save(
                    fixture.workflowId,
                    'Updated Workflow',
                    testPipeline('pipeline-updated', 'workflow-1'),
                    {},
                ),
            ),
        ).toThrow('updated trigger unavailable');

        expect(fixture.activator.isActive(fixture.workflowId)).toBe(true);
        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({
                name: 'Test Workflow',
                enabled: true,
                activation: { kind: 'active' },
            }),
        );
        expect(activationCount).toBe(3);
        expect(teardowns[0]).toHaveBeenCalledTimes(1);
        expect(teardowns).toHaveLength(2);
    });

    it('compensates a persistence failure after update reactivation', () => {
        const teardowns: Array<ReturnType<typeof vi.fn>> = [];
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            const teardown = vi.fn(() => {});
            teardowns.push(teardown);
            return teardown;
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);
        const persistenceError = new Error('updated enabled state could not be persisted');
        vi.spyOn(fixture.store, 'setEnabled').mockImplementationOnce(() => {
            throw persistenceError;
        });

        expect(() =>
            fixture.lifecycle.update(fixture.workflowId, () =>
                fixture.store.save(
                    fixture.workflowId,
                    'Updated Workflow',
                    testPipeline('pipeline-updated-persist', 'workflow-1'),
                    {},
                ),
            ),
        ).toThrow(persistenceError);

        expect(fixture.activator.isActive(fixture.workflowId)).toBe(true);
        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({
                name: 'Test Workflow',
                enabled: true,
                activation: { kind: 'active' },
            }),
        );
        expect(activate).toHaveBeenCalledTimes(3);
        expect(teardowns[0]).toHaveBeenCalledTimes(1);
        expect(teardowns[1]).toHaveBeenCalledTimes(1);
        expect(teardowns).toHaveLength(3);
    });

    it('restores enabled state and reactivates when update save throws', () => {
        const teardowns: Array<ReturnType<typeof vi.fn>> = [];
        const activate = vi.fn<TriggerHandler['activate']>(() => {
            const teardown = vi.fn(() => {});
            teardowns.push(teardown);
            return teardown;
        });
        const fixture = createFixture(activate);
        fixtures.push(fixture);
        fixture.lifecycle.enable(fixture.workflowId);

        const saveError = new Error('disk full');
        expect(() =>
            fixture.lifecycle.update(fixture.workflowId, () => {
                throw saveError;
            }),
        ).toThrow(saveError);

        expect(fixture.store.getSummary(fixture.workflowId)).toMatchObject(
            Option.some({
                enabled: true,
                activation: { kind: 'active' },
            }),
        );
        expect(activate).toHaveBeenCalledTimes(2);
        expect(teardowns[0]).toHaveBeenCalledTimes(1);
    });

    it('returns empty transition results for missing and disabled workflows', () => {
        const fixture = createFixture(() => () => {});
        fixtures.push(fixture);

        expect(fixture.lifecycle.enable('missing')).toEqual(Option.none());
        expect(fixture.lifecycle.disable('missing')).toEqual(Option.none());
        expect(fixture.lifecycle.toggle('missing')).toEqual(Option.none());
        expect(fixture.lifecycle.activateEnabled('missing')).toEqual(Option.none());
        expect(fixture.lifecycle.activateEnabled(fixture.workflowId)).toMatchObject(
            Option.some({ enabled: false }),
        );
    });

    it('updates a disabled workflow without waiting for activation or reactivating it', async () => {
        const fixture = createFixture(() => () => {});
        fixtures.push(fixture);

        const result = await fixture.lifecycle.updateAndDrain(fixture.workflowId, () =>
            fixture.store.save(
                fixture.workflowId,
                'Updated Disabled Workflow',
                testPipeline('pipeline-disabled-update', 'workflow-1'),
                {},
            ),
        );

        expect(result).toMatchObject({
            name: 'Updated Disabled Workflow',
            enabled: false,
            activation: { kind: 'disabled' },
        });
    });
});
