import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import type { Manifest } from '@sigil/schema/manifest';
import {
    pluginNodeIdentity,
    registerSerializableNodeContract,
    type SerializableNodeContractInput,
} from '@sigil/schema/node-contract';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Either, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createEngine } from '../core/engine.js';
import type { NodeHandler, NodeRunResult, TriggerHandler } from '../node-handlers/types.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator, getDeactivationHook } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

describe('WorkflowActivator lifecycle', () => {
    it('tears down only the Workflow whose Trigger activation failed', () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-activator-lifecycle-'));
        const engine = createEngine();
        let activator: ReturnType<typeof createWorkflowActivator> | undefined;

        try {
            const callbacks: Array<(ctx: WorkflowContext) => void> = [];
            const teardowns: Array<ReturnType<typeof vi.fn>> = [];
            const triggerHandler: TriggerHandler = {
                activate: (_config, onEvent) => {
                    callbacks.push(onEvent);
                    const teardown = vi.fn((): void => {});
                    teardowns.push(teardown);
                    return teardown;
                },
                execute: async ({ ctx }): Promise<NodeRunResult> => ({
                    outputCtx: ctx,
                    activePort: 'out',
                }),
            };
            engine.handlerRegistry.register('test-trigger', triggerHandler);
            registerSerializableNodeContract(engine.contractRegistry, {
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
                    description: 'Test trigger for workflow activator coverage.',
                    category: 'trigger',
                },
            });

            const store = createWorkflowStore(
                storageDir,
                workflowTopologyOptions(engine.handlerRegistry, engine.contractRegistry),
            );
            const createPipeline = (pipelineId: string, workflowId: string): CompiledPipeline => ({
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
            });
            const first = store.create(
                'First Workflow',
                createPipeline('pipeline-first', 'workflow-first'),
                {},
            );
            const second = store.create(
                'Second Workflow',
                createPipeline('pipeline-second', 'workflow-second'),
                {},
            );

            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);
            expect(activator.activate(first.id)).toBe(true);
            expect(activator.activate(second.id)).toBe(true);
            expect(callbacks).toHaveLength(2);

            const secondCallback = callbacks[1];
            if (!secondCallback) throw new Error('second activation callback missing');
            const secondFailureHook = Option.getOrUndefined(getDeactivationHook(secondCallback));
            expect(secondFailureHook).toBeDefined();
            secondFailureHook?.();
            secondFailureHook?.();

            expect(teardowns[0]).not.toHaveBeenCalled();
            expect(teardowns[1]).toHaveBeenCalledTimes(1);
            expect(activator.activeWorkflowIds()).toEqual([first.id]);
            expect(activator.deactivate(second.id)).toBe(false);
        } finally {
            activator?.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });

    it('cancels dependent active and queued runs through the Engine permission transition', async () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-activator-permission-revocation-'));
        const pluginId = 'com.sigil.permission-dependent';
        const workflowId = 'workflow-permission-dependent';
        const pipelineId = 'pipeline-permission-dependent';
        const unaffectedWorkflowId = 'workflow-permission-independent';
        const engine = createEngine({
            defaultDatabasePath: join(storageDir, 'engine.db'),
            permissionOverridesPath: join(storageDir, 'permission-overrides.json'),
        });
        let activator: ReturnType<typeof createWorkflowActivator> | undefined;
        const events: Array<{
            readonly name: string;
            readonly payload: Readonly<Record<string, unknown>>;
        }> = [];

        try {
            const nodeContract = {
                identity: pluginNodeIdentity(pluginId, 'test-permission-action'),
                version: 1,
                compatibility: { minimumReaderVersion: 1, maximumReaderVersion: 1 },
                role: 'action',
                defaultConfig: {},
                outputPorts: {
                    kind: 'fixed',
                    ports: [{ id: 'out', label: 'Output' }],
                },
                display: {
                    label: 'Permission Action',
                    description: 'Action used for permission revocation coverage.',
                    category: 'utility',
                },
            } as const satisfies SerializableNodeContractInput;
            const manifest: Manifest = {
                id: pluginId,
                version: '1.0.0',
                permissions: ['filesystem.read'],
                emits: ['plugin.event'],
                nodeType: 'test-permission-action',
                nodeContract,
            };
            expect(Either.isRight(engine.registry.register(manifest))).toBe(true);
            registerSerializableNodeContract(engine.contractRegistry, nodeContract);

            const callbacks: Array<(ctx: WorkflowContext) => void> = [];
            const triggerHandler: TriggerHandler = {
                activate: (_config, onEvent) => {
                    callbacks.push(onEvent);
                    return () => {};
                },
                execute: async ({ ctx }): Promise<NodeRunResult> => ({
                    outputCtx: ctx,
                    activePort: 'out',
                }),
            };
            let actionStarted = 0;
            const actionHandler: NodeHandler = {
                execute: async ({ ctx }, deps): Promise<NodeRunResult> => {
                    actionStarted += 1;
                    return new Promise<NodeRunResult>((resolve) => {
                        const finish = (): void => resolve({ outputCtx: ctx, activePort: 'out' });
                        if (deps.signal?.aborted) {
                            finish();
                            return;
                        }
                        deps.signal?.addEventListener('abort', finish, { once: true });
                    });
                },
            };
            engine.handlerRegistry.register('test-permission-trigger', triggerHandler);
            engine.handlerRegistry.register('test-permission-action', actionHandler);
            registerSerializableNodeContract(engine.contractRegistry, {
                identity: pluginNodeIdentity(
                    'com.sigil.test-permission-trigger',
                    'test-permission-trigger',
                ),
                version: 1,
                role: 'trigger',
                defaultConfig: {},
                outputPorts: {
                    kind: 'fixed',
                    ports: [{ id: 'out', label: 'Output' }],
                },
                display: {
                    label: 'Permission Trigger',
                    description: 'Trigger used for permission revocation coverage.',
                    category: 'trigger',
                },
            });

            const store = createWorkflowStore(
                storageDir,
                workflowTopologyOptions(engine.handlerRegistry, engine.contractRegistry),
            );
            const pipeline: CompiledPipeline = {
                id: pipelineId,
                workflowId,
                schemaVersion: 1,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'test-permission-trigger',
                        pluginId: 'com.sigil.test-permission-trigger',
                        config: {},
                    },
                    {
                        id: 'action',
                        type: 'test-permission-action',
                        pluginId,
                        config: {},
                    },
                ],
                edges: [
                    {
                        id: 'trigger-to-action',
                        source: 'trigger',
                        target: 'action',
                        sourcePort: 'out',
                    },
                ],
            };
            store.create('Permission Dependent Workflow', pipeline, {});
            store.create(
                'Permission Independent Workflow',
                {
                    id: 'pipeline-permission-independent',
                    workflowId: unaffectedWorkflowId,
                    schemaVersion: 1,
                    nodes: [
                        {
                            id: 'trigger',
                            type: 'test-permission-trigger',
                            pluginId: 'com.sigil.test-permission-trigger',
                            config: {},
                        },
                    ],
                    edges: [],
                },
                {},
            );
            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);
            engine.bus.subscribe((event) => {
                events.push({ name: event.name, payload: event.payload });
            });

            expect(activator.activate(workflowId)).toBe(true);
            expect(activator.activate(unaffectedWorkflowId)).toBe(true);
            const callback = callbacks[0];
            if (!callback) throw new Error('permission trigger callback missing');
            const unaffectedCallback = callbacks[1];
            if (!unaffectedCallback) throw new Error('unaffected trigger callback missing');
            const context: WorkflowContext = { event: 'test.event', payload: {}, vars: {} };
            callback(context);
            await vi.waitFor(() => expect(actionStarted).toBe(1));
            callback(context);

            const result = await engine.applyPermissionOverride(pluginId, []);

            expect(result).toMatchObject({
                ok: true,
                grantedPermissions: [],
            });
            if (!result.ok) return;
            expect(result.cancelledRunIds).toHaveLength(2);
            expect(actionStarted).toBe(1);

            const cancellations = events.filter((event) => event.name === 'workflow.cancelled');
            expect(cancellations).toHaveLength(2);
            expect(cancellations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        payload: expect.objectContaining({
                            workflowId,
                            pipelineId,
                            reason: 'permission_revoked',
                            phase: 'running',
                        }),
                    }),
                    expect.objectContaining({
                        payload: expect.objectContaining({
                            workflowId,
                            pipelineId,
                            reason: 'permission_revoked',
                            phase: 'queued',
                        }),
                    }),
                ]),
            );
            expect(cancellations.map((event) => event.payload.runId)).toEqual(
                expect.arrayContaining([...result.cancelledRunIds]),
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
            expect(actionStarted).toBe(1);

            unaffectedCallback(context);
            await vi.waitFor(() => {
                expect(
                    events.some(
                        (event) =>
                            event.name === 'workflow.completed' &&
                            event.payload.workflowId === unaffectedWorkflowId,
                    ),
                ).toBe(true);
            });
        } finally {
            activator?.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });
});
