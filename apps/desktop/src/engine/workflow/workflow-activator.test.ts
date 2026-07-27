import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowDocument } from '@sigil/contracts';
import {
    EventNameSchema,
    NodeTypeNameSchema,
    PluginIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import type { Manifest } from '@sigil/contracts/manifest';
import type { SerializableNodeContractInput } from '@sigil/contracts/node-contract';
import type { WorkflowContext } from '@sigil/contracts/workflow-context';
import {
    fixedOutputPortSpec,
    pluginNodeIdentity,
    registerSerializableNodeContract,
} from '@sigil/workflow-domain/node-contract';
import { Either, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { testDocument } from '../../test-support/pipeline-fixtures.js';
import { createEngine } from '../core/engine.js';
import type { NodeHandler, NodeRunResult, TriggerHandler } from '../node-handlers/types.js';
import { createWorkflowActivator, getDeactivationHook } from './workflow-activator.js';
import { workflowCompilationOptions } from './workflow-compilation.js';
import { createWorkflowStore } from './workflow-store.js';

const testWorkflowId = (value: string) => WorkflowIdSchema.parse(value);
const pid = (id: string) => PluginIdSchema.parse(id);

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
                identity: pluginNodeIdentity(pid('com.sigil.test-trigger'), 'test-trigger'),
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
                workflowCompilationOptions(engine.handlerRegistry, engine.contractRegistry),
            );
            const createPipeline = (pipelineId: string, workflowId: string): WorkflowDocument =>
                testDocument({
                    id: pipelineId,
                    workflowId,
                    nodes: [
                        {
                            id: 'trigger',
                            type: 'test-trigger',
                            pluginId: pid('com.sigil.test-trigger'),
                            config: {},
                        },
                    ],
                    edges: [],
                });
            const firstSummary = store.create(
                'First Workflow',
                createPipeline('pipeline-first', 'workflow-first'),
                {},
            );
            const first = { ...firstSummary, id: testWorkflowId(firstSummary.id) };
            const secondSummary = store.create(
                'Second Workflow',
                createPipeline('pipeline-second', 'workflow-second'),
                {},
            );
            const second = { ...secondSummary, id: testWorkflowId(secondSummary.id) };

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
        const pluginId = pid('com.sigil.permission-dependent');
        const workflowId = testWorkflowId('workflow-permission-dependent');
        const pipelineId = 'pipeline-permission-dependent';
        const unaffectedWorkflowId = testWorkflowId('workflow-permission-independent');
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
                role: 'action',
                defaultConfig: {},
                outputPorts: fixedOutputPortSpec(['out']),
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
                emits: [EventNameSchema.parse('plugin.event')],
                nodeType: NodeTypeNameSchema.parse('test-permission-action'),
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
                    pid('com.sigil.test-permission-trigger'),
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
                workflowCompilationOptions(engine.handlerRegistry, engine.contractRegistry),
            );
            const pipeline: WorkflowDocument = testDocument({
                id: pipelineId,
                workflowId,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'test-permission-trigger',
                        pluginId: pid('com.sigil.test-permission-trigger'),
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
            });
            store.create('Permission Dependent Workflow', pipeline, {});
            store.create(
                'Permission Independent Workflow',
                testDocument({
                    id: 'pipeline-permission-independent',
                    workflowId: unaffectedWorkflowId,
                    nodes: [
                        {
                            id: 'trigger',
                            type: 'test-permission-trigger',
                            pluginId: pid('com.sigil.test-permission-trigger'),
                            config: {},
                        },
                    ],
                    edges: [],
                }),
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
