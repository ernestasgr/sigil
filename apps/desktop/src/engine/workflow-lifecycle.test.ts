import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEngine } from './engine.js';
import type { NodeRunResult, TriggerHandler } from './node-handlers/types.js';
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

    it('persists enabled intent with a failed activation state when activation throws', () => {
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
            enabled: true,
            activation: { kind: 'failed', message: 'permission denied' },
        });
        expect(
            JSON.parse(
                readFileSync(join(fixture.storageDir, `${fixture.workflowId}.json`), 'utf8'),
            ),
        ).toMatchObject({
            enabled: true,
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
        fixture.lifecycle.enable(fixture.workflowId);

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
            enabled: true,
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
});
