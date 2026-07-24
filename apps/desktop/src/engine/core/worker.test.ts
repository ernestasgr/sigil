import type { CompiledPipeline } from '@sigil/schema';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import { Effect, Either, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
    EngineChannel,
    type EngineCreateWorkflow,
    type EngineDeleteWorkflow,
    type EngineDeleteWorkflowStateKey,
    type EngineFireManualTrigger,
    type EngineGetWorkflow,
    type EngineListPlugins,
    type EnginePing,
    type EngineReadProperties,
    type EngineReadWorkflowState,
    type EngineRetryWorkflow,
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineSetWorkflowStateKey,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
} from '../../shared/ipc-channels.js';
import { createWorkflowTopologyError } from '../workflow/workflow-topology-error.js';
import { type DispatchSubsystems, dispatch } from './dispatch.js';

const { readPropertiesFileMock, writePropertiesFileMock } = vi.hoisted(() => ({
    readPropertiesFileMock: vi.fn(),
    writePropertiesFileMock: vi.fn(),
}));

vi.mock('./properties-loader.js', () => ({
    readPropertiesFile: readPropertiesFileMock,
    writePropertiesFile: writePropertiesFileMock,
}));

function createFakeSubsystems(propertyDefaults?: Readonly<Record<string, unknown>>): {
    subsystems: DispatchSubsystems;
    postMessage: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    broadcastWorkflowsList: ReturnType<typeof vi.fn>;
    engine: {
        execute: ReturnType<typeof vi.fn>;
        validateProperties: ReturnType<typeof vi.fn>;
        applyProperties: ReturnType<typeof vi.fn>;
        applyPermissionOverride: ReturnType<typeof vi.fn>;
        registry: {
            all: ReturnType<typeof vi.fn>;
            get: ReturnType<typeof vi.fn>;
            has: ReturnType<typeof vi.fn>;
        };
        updatePluginPermissions: ReturnType<typeof vi.fn>;
        propertyRegistry?: { defaults: ReturnType<typeof vi.fn> };
        permissionOverrides: {
            has: ReturnType<typeof vi.fn>;
            get: ReturnType<typeof vi.fn>;
            set: ReturnType<typeof vi.fn>;
        };
        workflowStateStore: {
            listKeys: ReturnType<typeof vi.fn>;
            setKey: ReturnType<typeof vi.fn>;
            deleteKey: ReturnType<typeof vi.fn>;
            deleteWorkflow: ReturnType<typeof vi.fn>;
        };
    };
    store: {
        get: ReturnType<typeof vi.fn>;
        getSummary: ReturnType<typeof vi.fn>;
        toggle: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        save: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };
    activator: {
        activate: ReturnType<typeof vi.fn>;
        deactivate: ReturnType<typeof vi.fn>;
    };
} {
    readPropertiesFileMock.mockClear();
    writePropertiesFileMock.mockClear();
    readPropertiesFileMock.mockReturnValue(Effect.succeed({ loadedKey: 'loadedValue' }));
    writePropertiesFileMock.mockReturnValue(Either.right(undefined));
    const postMessage = vi.fn();
    const log = vi.fn();
    const broadcastWorkflowsList = vi.fn();
    const execute = vi.fn().mockResolvedValue(undefined);
    const registryAll = vi.fn().mockReturnValue([]);
    const registryGet = vi.fn().mockReturnValue(
        Option.some({
            id: 'plugin-a',
            version: '1.0.0',
            permissions: [],
            emits: ['stub.event'],
        }),
    );
    const validateProperties = vi.fn((properties: Readonly<Record<string, unknown>>) => ({
        ok: true as const,
        properties,
    }));
    const applyProperties = vi.fn(() => ({ applied: {}, restartRequired: [] as string[] }));
    const applyPermissionOverride = vi
        .fn()
        .mockReturnValue({ ok: true as const, grantedPermissions: [] as const });
    const propertyRegistry =
        propertyDefaults === undefined
            ? undefined
            : { defaults: vi.fn().mockReturnValue(propertyDefaults) };
    const permissionHas = vi.fn();
    const permissionGet = vi.fn();
    const permissionSet = vi.fn().mockReturnValue(Either.right(undefined));
    const registryHas = vi.fn().mockReturnValue(true);
    const updatePluginPermissions = vi.fn();
    const listKeys = vi.fn().mockReturnValue([]);
    const setKey = vi.fn();
    const deleteKey = vi.fn();
    const deleteWorkflow = vi.fn();
    const storeGet = vi.fn();
    const storeGetSummary = vi.fn();
    const storeToggle = vi.fn();
    const storeCreate = vi.fn();
    const storeSave = vi.fn();
    const storeRemove = vi.fn();
    const activatorActivate = vi.fn();
    const activatorDeactivate = vi.fn();

    return {
        subsystems: {
            postMessage,
            engine: {
                execute,
                validateProperties,
                applyProperties,
                applyPermissionOverride,
                registry: { all: registryAll, get: registryGet, has: registryHas },
                updatePluginPermissions,
                ...(propertyRegistry === undefined ? {} : { propertyRegistry }),
                permissionOverrides: {
                    has: permissionHas,
                    get: permissionGet,
                    set: permissionSet,
                },
                workflowStateStore: {
                    listKeys,
                    setKey,
                    deleteKey,
                    deleteWorkflow,
                },
            } as unknown as DispatchSubsystems['engine'],
            store: {
                get: storeGet,
                getSummary: storeGetSummary,
                toggle: storeToggle,
                create: storeCreate,
                save: storeSave,
                remove: storeRemove,
            } as unknown as DispatchSubsystems['store'],
            activator: {
                activate: activatorActivate,
                deactivate: activatorDeactivate,
            } as unknown as DispatchSubsystems['activator'],
            broadcastWorkflowsList,
            log,
            propertiesPath: '/fake/properties.json',
        },
        postMessage,
        log,
        broadcastWorkflowsList,
        engine: {
            execute,
            validateProperties,
            applyProperties,
            applyPermissionOverride,
            registry: { all: registryAll, get: registryGet, has: registryHas },
            updatePluginPermissions,
            ...(propertyRegistry === undefined ? {} : { propertyRegistry }),
            permissionOverrides: { has: permissionHas, get: permissionGet, set: permissionSet },
            workflowStateStore: { listKeys, setKey, deleteKey, deleteWorkflow },
        },
        store: {
            get: storeGet,
            getSummary: storeGetSummary,
            toggle: storeToggle,
            create: storeCreate,
            save: storeSave,
            remove: storeRemove,
        },
        activator: { activate: activatorActivate, deactivate: activatorDeactivate },
    };
}

describe('dispatch', () => {
    it('routes Ping to handlePing which posts a Pong', () => {
        const { subsystems, postMessage } = createFakeSubsystems();

        const message: EnginePing = {
            correlationId: 'corr-ping-1',
            type: EngineChannel.Ping,
        };
        dispatch(message, subsystems);

        expect(postMessage).toHaveBeenCalledTimes(1);
        const call = postMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call).toMatchObject({
            type: EngineChannel.Pong,
            correlationId: 'corr-ping-1',
        });
        expect(typeof (call as { receivedAt: number }).receivedAt).toBe('number');
    });

    it('routes FireTestEvent to handleFireTestEvent and acknowledges success', async () => {
        const { subsystems, engine } = createFakeSubsystems();

        await dispatch(
            { type: EngineChannel.FireTestEvent, correlationId: 'corr-test-event' },
            subsystems,
        );

        expect(engine.execute).toHaveBeenCalledTimes(1);
        expect(engine.execute).toHaveBeenCalledWith(sampleManualTriggerToLog);
        expect(subsystems.postMessage).toHaveBeenCalledWith({
            type: EngineChannel.FireTestEventResult,
            correlationId: 'corr-test-event',
            ok: true,
        });
    });

    it('routes FireManualTrigger to handleFireManualTrigger and acknowledges success', async () => {
        const { subsystems, engine } = createFakeSubsystems();
        const pipeline = { id: 'p-1' } as CompiledPipeline;

        const message: EngineFireManualTrigger = {
            correlationId: 'corr-manual-trigger',
            type: EngineChannel.FireManualTrigger,
            pipeline,
        };
        await dispatch(message, subsystems);

        expect(engine.execute).toHaveBeenCalledTimes(1);
        expect(engine.execute).toHaveBeenCalledWith(pipeline);
        expect(subsystems.postMessage).toHaveBeenCalledWith({
            type: EngineChannel.FireManualTriggerResult,
            correlationId: 'corr-manual-trigger',
            ok: true,
        });
    });

    it('routes ToggleWorkflow and calls store.get, store.toggle, activator, broadcast, and posts result', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log } =
            createFakeSubsystems();
        const before = { id: 'wf-1', name: 'Test WF', enabled: false };
        const toggled = { id: 'wf-1', name: 'Test WF', enabled: true };
        store.get.mockReturnValue(Option.some(before));
        store.toggle.mockReturnValue(Option.some(toggled));

        const message: EngineToggleWorkflow = {
            type: EngineChannel.ToggleWorkflow,
            correlationId: 'corr-1',
            id: 'wf-1',
        };
        dispatch(message, subsystems);

        expect(store.get).toHaveBeenCalledWith('wf-1');
        expect(store.toggle).toHaveBeenCalledWith('wf-1');
        expect(log).toHaveBeenCalledWith('"Test WF" enabled');
        expect(activator.activate).toHaveBeenCalledWith('wf-1');
        expect(activator.deactivate).not.toHaveBeenCalled();
        expect(broadcastWorkflowsList).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'corr-1',
            summary: toggled,
        });
    });

    it('routes ToggleWorkflow and deactivates when workflow is disabled', () => {
        const { subsystems, store, activator, log } = createFakeSubsystems();
        const before = { id: 'wf-1', name: 'Test WF', enabled: true };
        const toggled = { id: 'wf-1', name: 'Test WF', enabled: false };
        store.get.mockReturnValue(Option.some(before));
        store.toggle.mockReturnValue(Option.some(toggled));

        dispatch(
            { type: EngineChannel.ToggleWorkflow, correlationId: 'c-1', id: 'wf-1' },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith('"Test WF" disabled');
        expect(activator.deactivate).toHaveBeenCalledWith('wf-1');
        expect(activator.activate).not.toHaveBeenCalled();
    });

    it('routes ToggleWorkflow and does nothing extra when toggle returns null', () => {
        const { subsystems, postMessage, store, activator, log } = createFakeSubsystems();
        store.get.mockReturnValue(Option.none());
        store.toggle.mockReturnValue(Option.none());

        dispatch(
            { type: EngineChannel.ToggleWorkflow, correlationId: 'c-1', id: 'wf-1' },
            subsystems,
        );

        expect(log).not.toHaveBeenCalled();
        expect(activator.activate).not.toHaveBeenCalled();
        expect(activator.deactivate).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'c-1',
            summary: null,
        });
    });

    it('routes ToggleWorkflow through the lifecycle transition seam and posts null summary when workflow is not found', () => {
        const { subsystems, postMessage, store } = createFakeSubsystems();
        const toggle = vi.fn().mockReturnValue(Option.none());
        (subsystems as unknown as { lifecycle: { toggle: typeof toggle } }).lifecycle = { toggle };
        store.getSummary.mockReturnValue(Option.none());

        dispatch(
            {
                type: EngineChannel.ToggleWorkflow,
                correlationId: 'lifecycle-missing',
                id: 'missing',
            },
            subsystems,
        );

        expect(toggle).toHaveBeenCalledWith('missing');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'lifecycle-missing',
            summary: null,
        });
    });

    it('routes ToggleWorkflow through the lifecycle transition seam when available', () => {
        const { subsystems, postMessage, store, log } = createFakeSubsystems();
        const before = {
            id: 'wf-1',
            name: 'Test WF',
            enabled: false,
            activation: { kind: 'disabled' } as const,
        };
        const after = {
            id: 'wf-1',
            name: 'Test WF',
            enabled: true,
            activation: { kind: 'active' } as const,
        };
        const toggle = vi.fn().mockReturnValue(Option.some(after));
        (subsystems as unknown as { lifecycle: { toggle: typeof toggle } }).lifecycle = { toggle };
        store.getSummary.mockReturnValue(Option.some(before));

        dispatch(
            { type: EngineChannel.ToggleWorkflow, correlationId: 'lifecycle-toggle', id: 'wf-1' },
            subsystems,
        );

        expect(toggle).toHaveBeenCalledWith('wf-1');
        expect(store.toggle).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('"Test WF" enabled');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'lifecycle-toggle',
            summary: after,
        });
    });

    it('routes RetryWorkflow through the lifecycle transition seam and posts null summary when workflow is not found', () => {
        const { subsystems, postMessage } = createFakeSubsystems();
        const retry = vi.fn().mockReturnValue(Option.none());
        (subsystems as unknown as { lifecycle: { retry: typeof retry } }).lifecycle = { retry };

        dispatch(
            {
                type: EngineChannel.RetryWorkflow,
                correlationId: 'lifecycle-retry-missing',
                id: 'missing',
            },
            subsystems,
        );

        expect(retry).toHaveBeenCalledWith('missing');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.RetryWorkflowResult,
            correlationId: 'lifecycle-retry-missing',
            summary: null,
        });
    });

    it('routes RetryWorkflow through the lifecycle transition seam', () => {
        const { subsystems, postMessage, log } = createFakeSubsystems();
        const summary = {
            id: 'wf-1',
            name: 'Test WF',
            enabled: true,
            activation: { kind: 'active' } as const,
        };
        const retry = vi.fn().mockReturnValue(Option.some(summary));
        (subsystems as unknown as { lifecycle: { retry: typeof retry } }).lifecycle = { retry };

        const message: EngineRetryWorkflow = {
            type: EngineChannel.RetryWorkflow,
            correlationId: 'lifecycle-retry',
            id: 'wf-1',
        };
        dispatch(message, subsystems);

        expect(retry).toHaveBeenCalledWith('wf-1');
        expect(log).toHaveBeenCalledWith('Retrying workflow "Test WF" (wf-1)');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.RetryWorkflowResult,
            correlationId: 'lifecycle-retry',
            summary,
        });
    });

    it('routes CreateWorkflow and calls store.create, broadcast, and posts result', () => {
        const { subsystems, postMessage, store, broadcastWorkflowsList, log } =
            createFakeSubsystems();
        const summary = { id: 'new-id', name: 'New WF', enabled: false };
        store.create.mockReturnValue(summary);

        const message: EngineCreateWorkflow = {
            type: EngineChannel.CreateWorkflow,
            correlationId: 'corr-2',
            name: 'New WF',
            pipeline: { id: 'p-1' } as CompiledPipeline,
            positions: {},
        };
        dispatch(message, subsystems);

        expect(store.create).toHaveBeenCalledWith('New WF', message.pipeline, {});
        expect(log).toHaveBeenCalledWith('Created workflow "New WF" (new-id)');
        expect(broadcastWorkflowsList).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.CreateWorkflowResult,
            correlationId: 'corr-2',
            summary,
        });
    });

    it('returns structured topology diagnostics when CreateWorkflow is rejected', () => {
        const { subsystems, postMessage, store, broadcastWorkflowsList } = createFakeSubsystems();
        const diagnostic = {
            severity: 'error',
            code: 'empty_pipeline',
            target: { kind: 'pipeline' },
            message: 'Add a Trigger before saving.',
        } as const;
        store.create.mockImplementation(() => {
            throw createWorkflowTopologyError([diagnostic]);
        });

        dispatch(
            {
                type: EngineChannel.CreateWorkflow,
                correlationId: 'corr-invalid',
                name: 'Invalid WF',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: {},
            },
            subsystems,
        );

        expect(broadcastWorkflowsList).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.CreateWorkflowResult,
            correlationId: 'corr-invalid',
            error: '[empty_pipeline] Add a Trigger before saving.',
            diagnostics: [diagnostic],
        });
    });

    it('returns a structured persistence failure when CreateWorkflow cannot commit its file', () => {
        const { subsystems, postMessage, store, broadcastWorkflowsList } = createFakeSubsystems();
        const diagnostic = {
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: 'C:/workflows/wf-1.json',
            message: 'replacement denied',
        } as const;
        store.create.mockImplementation(() => {
            throw Object.assign(new Error('Could not create Workflow "wf-1": replacement denied'), {
                kind: 'workflow_persistence' as const,
                operation: 'create' as const,
                workflowId: 'wf-1',
                diagnostic,
                diagnostics: [diagnostic],
            });
        });

        dispatch(
            {
                type: EngineChannel.CreateWorkflow,
                correlationId: 'corr-write-failed',
                name: 'Failed WF',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: {},
            },
            subsystems,
        );

        expect(broadcastWorkflowsList).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.CreateWorkflowResult,
            correlationId: 'corr-write-failed',
            error: 'Could not create Workflow "wf-1": replacement denied',
            diagnostics: [diagnostic],
        });
    });

    it('routes UpdateWorkflow for an existing workflow', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log } =
            createFakeSubsystems();
        const existing = { id: 'wf-1', name: 'Old', enabled: true };
        const summary = { id: 'wf-1', name: 'Updated', enabled: true };
        store.get.mockReturnValue(Option.some(existing));
        store.save.mockReturnValue(summary);

        const message: EngineUpdateWorkflow = {
            type: EngineChannel.UpdateWorkflow,
            correlationId: 'corr-3',
            id: 'wf-1',
            name: 'Updated',
            pipeline: { id: 'p-1' } as CompiledPipeline,
            positions: {},
        };
        dispatch(message, subsystems);

        expect(activator.deactivate).toHaveBeenCalledWith('wf-1');
        expect(store.get).toHaveBeenCalledWith('wf-1');
        expect(store.save).toHaveBeenCalledWith('wf-1', 'Updated', message.pipeline, {});
        expect(log).toHaveBeenCalledWith('Updated workflow "Updated" (wf-1)');
        expect(activator.activate).toHaveBeenCalledWith('wf-1');
        expect(broadcastWorkflowsList).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.UpdateWorkflowResult,
            correlationId: 'corr-3',
            summary,
        });
    });

    it('routes UpdateWorkflow and reactivates only if enabled', () => {
        const { subsystems, activator, store } = createFakeSubsystems();
        store.get.mockReturnValue(Option.some({ id: 'wf-1', name: 'Old', enabled: false }));
        store.save.mockReturnValue({ id: 'wf-1', name: 'Updated', enabled: false });

        dispatch(
            {
                type: EngineChannel.UpdateWorkflow,
                correlationId: 'c',
                id: 'wf-1',
                name: 'Updated',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: {},
            },
            subsystems,
        );

        expect(activator.activate).not.toHaveBeenCalled();
    });

    it('routes UpdateWorkflow and treats it as create when the id is missing', () => {
        const { subsystems, store, log } = createFakeSubsystems();
        store.get.mockReturnValue(Option.none());
        store.save.mockReturnValue({ id: 'wf-1', name: 'New', enabled: false });

        dispatch(
            {
                type: EngineChannel.UpdateWorkflow,
                correlationId: 'c',
                id: 'wf-1',
                name: 'New',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: {},
            },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith('Created workflow "New" via update for missing id (wf-1)');
    });

    it('coordinates UpdateWorkflow through the lifecycle when one is available', async () => {
        const { subsystems, store } = createFakeSubsystems();
        const updateAndDrain = vi.fn((_id: string, update: () => unknown) => update());
        (
            subsystems as unknown as {
                lifecycle: { updateAndDrain: typeof updateAndDrain };
            }
        ).lifecycle = { updateAndDrain };
        store.get.mockReturnValue(Option.some({ id: 'wf-1', name: 'Old', enabled: false }));
        store.save.mockReturnValue({ id: 'wf-1', name: 'Updated', enabled: false });

        await dispatch(
            {
                type: EngineChannel.UpdateWorkflow,
                correlationId: 'lifecycle-update',
                id: 'wf-1',
                name: 'Updated',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: {},
            },
            subsystems,
        );

        expect(updateAndDrain).toHaveBeenCalledWith('wf-1', expect.any(Function));
        expect(store.save).toHaveBeenCalledWith('wf-1', 'Updated', { id: 'p-1' }, {});
    });

    it('routes DeleteWorkflow and calls remove, deactivates, broadcasts, and posts result', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log, engine } =
            createFakeSubsystems();
        store.remove.mockReturnValue(true);

        const message: EngineDeleteWorkflow = {
            type: EngineChannel.DeleteWorkflow,
            correlationId: 'corr-4',
            id: 'wf-1',
        };
        dispatch(message, subsystems);

        expect(activator.deactivate).toHaveBeenCalledWith('wf-1');
        expect(store.remove).toHaveBeenCalledWith('wf-1');
        expect(engine.workflowStateStore.deleteWorkflow).toHaveBeenCalledWith('wf-1');
        expect(log).toHaveBeenCalledWith('Deleted workflow (wf-1)');
        expect(broadcastWorkflowsList).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.DeleteWorkflowResult,
            correlationId: 'corr-4',
            success: true,
        });
    });

    it('routes DeleteWorkflow and does not log when remove returns false', () => {
        const { subsystems, store, log, engine } = createFakeSubsystems();
        store.remove.mockReturnValue(false);

        dispatch(
            { type: EngineChannel.DeleteWorkflow, correlationId: 'c', id: 'wf-1' },
            subsystems,
        );

        expect(log).not.toHaveBeenCalled();
        expect(engine.workflowStateStore.deleteWorkflow).not.toHaveBeenCalled();
    });

    it('disables a workflow through the lifecycle and waits for in-flight runs before delete', async () => {
        const { subsystems, store, activator } = createFakeSubsystems();
        const disable = vi.fn();
        const hasInFlightRuns = vi.fn().mockReturnValue(true);
        const waitForRuns = vi.fn().mockResolvedValue(undefined);
        (subsystems as unknown as { lifecycle: { disable: typeof disable } }).lifecycle = {
            disable,
        };
        (
            subsystems as unknown as {
                activator: {
                    hasInFlightRuns: typeof hasInFlightRuns;
                    waitForRuns: typeof waitForRuns;
                };
            }
        ).activator = { ...activator, hasInFlightRuns, waitForRuns };
        store.remove.mockReturnValue(false);

        await dispatch(
            { type: EngineChannel.DeleteWorkflow, correlationId: 'lifecycle-delete', id: 'wf-1' },
            subsystems,
        );

        expect(disable).toHaveBeenCalledWith('wf-1');
        expect(hasInFlightRuns).toHaveBeenCalledWith('wf-1');
        expect(waitForRuns).toHaveBeenCalledWith('wf-1');
        expect(activator.deactivate).not.toHaveBeenCalled();
    });

    it('routes GetWorkflow and posts found result when workflow exists', () => {
        const { subsystems, postMessage, store } = createFakeSubsystems();
        store.get.mockReturnValue(
            Option.some({
                name: 'My WF',
                pipeline: { id: 'p-1' } as CompiledPipeline,
                positions: { node1: { x: 1, y: 2 } },
            }),
        );

        const message: EngineGetWorkflow = {
            type: EngineChannel.GetWorkflow,
            correlationId: 'corr-5',
            id: 'wf-1',
        };
        dispatch(message, subsystems);

        expect(store.get).toHaveBeenCalledWith('wf-1');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.GetWorkflowResult,
            correlationId: 'corr-5',
            found: true,
            name: 'My WF',
            pipeline: { id: 'p-1' },
            positions: { node1: { x: 1, y: 2 } },
        });
    });

    it('routes GetWorkflow and posts not-found result when workflow is missing', () => {
        const { subsystems, postMessage, store } = createFakeSubsystems();
        store.get.mockReturnValue(Option.none());

        dispatch(
            { type: EngineChannel.GetWorkflow, correlationId: 'c', id: 'missing' },
            subsystems,
        );

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.GetWorkflowResult,
            correlationId: 'c',
            found: false,
            error: 'Workflow not found: missing',
        });
    });

    it('routes ListPlugins and posts result with plugin info', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        const manifest = { id: 'plugin-a', name: 'A', version: '1.0.0', permissions: [] };
        engine.registry.all.mockReturnValue([manifest]);
        engine.permissionOverrides.has.mockReturnValue(false);

        const message: EngineListPlugins = {
            type: EngineChannel.ListPlugins,
            correlationId: 'corr-6',
        };
        dispatch(message, subsystems);

        expect(engine.registry.all).toHaveBeenCalledTimes(1);
        expect(engine.permissionOverrides.has).toHaveBeenCalledWith('plugin-a');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ListPluginsResult,
            correlationId: 'corr-6',
            plugins: [{ manifest, grantedPermissions: [] }],
        });
    });

    it('routes ListPlugins and reports the effective manifest-bounded permissions', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        const manifest = {
            id: 'plugin-a',
            name: 'A',
            version: '1.0.0',
            permissions: ['filesystem.read'],
        };
        engine.registry.all.mockReturnValue([manifest]);
        engine.permissionOverrides.has.mockReturnValue(true);
        engine.permissionOverrides.get.mockReturnValue(['filesystem.read', 'network']);

        dispatch({ type: EngineChannel.ListPlugins, correlationId: 'c' }, subsystems);

        expect(engine.permissionOverrides.get).toHaveBeenCalledWith('plugin-a');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ListPluginsResult,
            correlationId: 'c',
            plugins: [{ manifest, grantedPermissions: ['filesystem.read'] }],
        });
    });

    it('delegates SetPermissionOverride to the Engine transition and posts its result', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();

        const message: EngineSetPermissionOverride = {
            type: EngineChannel.SetPermissionOverride,
            correlationId: 'corr-7',
            pluginId: 'plugin-a',
            overrides: [],
        };
        dispatch(message, subsystems);

        expect(engine.applyPermissionOverride).toHaveBeenCalledWith('plugin-a', []);
        expect(engine.permissionOverrides.set).not.toHaveBeenCalled();
        expect(engine.updatePluginPermissions).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: 'corr-7',
            ok: true,
            grantedPermissions: [],
        });
    });

    it('returns the Engine-owned effective view instead of echoing the raw request', () => {
        const { subsystems, engine } = createFakeSubsystems();
        engine.applyPermissionOverride.mockReturnValue({
            ok: true,
            grantedPermissions: ['filesystem.read'],
        });

        dispatch(
            {
                type: EngineChannel.SetPermissionOverride,
                correlationId: 'corr-bounded-update',
                pluginId: 'plugin-a',
                overrides: ['filesystem.read', 'network'],
            },
            subsystems,
        );

        expect(engine.applyPermissionOverride).toHaveBeenCalledWith('plugin-a', [
            'filesystem.read',
            'network',
        ]);
        expect(engine.updatePluginPermissions).not.toHaveBeenCalled();
        expect(subsystems.postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: 'corr-bounded-update',
            ok: true,
            grantedPermissions: ['filesystem.read'],
        });
    });

    it('passes an Engine-owned unknown Plugin rejection through unchanged', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        engine.applyPermissionOverride.mockReturnValue({
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId: 'plugin-ghost',
            error: 'Plugin "plugin-ghost" is not registered in the Manifest Registry.',
        });

        dispatch(
            {
                type: EngineChannel.SetPermissionOverride,
                correlationId: 'corr-unknown-plugin',
                pluginId: 'plugin-ghost',
                overrides: [],
            },
            subsystems,
        );

        expect(engine.applyPermissionOverride).toHaveBeenCalledWith('plugin-ghost', []);
        expect(engine.registry.has).not.toHaveBeenCalled();
        expect(engine.permissionOverrides.set).not.toHaveBeenCalled();
        expect(engine.updatePluginPermissions).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: 'corr-unknown-plugin',
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId: 'plugin-ghost',
            error: 'Plugin "plugin-ghost" is not registered in the Manifest Registry.',
        });
    });

    it('returns a failure outcome when a permission override cannot be committed', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        const diagnostic = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: 'C:/permission-overrides.json',
            message: 'disk full',
        } as const;
        engine.applyPermissionOverride.mockReturnValue({
            ok: false,
            kind: 'persistence',
            error: '[persistence:write] C:/permission-overrides.json: disk full',
            diagnostic,
        });

        dispatch(
            {
                type: EngineChannel.SetPermissionOverride,
                correlationId: 'corr-permission-failed',
                pluginId: 'plugin-a',
                overrides: [],
            },
            subsystems,
        );

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: 'corr-permission-failed',
            ok: false,
            kind: 'persistence',
            error: '[persistence:write] C:/permission-overrides.json: disk full',
            diagnostic,
        });
        expect(engine.applyPermissionOverride).toHaveBeenCalledWith('plugin-a', []);
        expect(engine.permissionOverrides.set).not.toHaveBeenCalled();
        expect(engine.updatePluginPermissions).not.toHaveBeenCalled();
    });

    it('routes ReadProperties and posts the loaded properties', () => {
        const { subsystems, postMessage } = createFakeSubsystems();

        const message: EngineReadProperties = {
            type: EngineChannel.ReadProperties,
            correlationId: 'corr-8',
        };
        dispatch(message, subsystems);

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ReadPropertiesResult,
            correlationId: 'corr-8',
            properties: { loadedKey: 'loadedValue' },
        });
    });

    it('logs unexpected properties-file failures and returns an empty object', () => {
        const { subsystems, postMessage, log } = createFakeSubsystems();
        const diagnostic = {
            kind: 'persistence',
            operation: 'read',
            phase: 'read',
            path: '/fake/properties.json',
            message: 'permission denied',
        } as const;
        readPropertiesFileMock.mockReturnValue(Effect.fail(diagnostic));

        dispatch(
            { type: EngineChannel.ReadProperties, correlationId: 'corr-properties-failed' },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith(expect.stringContaining('Properties file diagnostic:'));
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ReadPropertiesResult,
            correlationId: 'corr-properties-failed',
            properties: {},
        });
    });

    it('includes registered property defaults in the ReadProperties response', () => {
        const defaults = { notifyOnWorkflowError: true, 'plugin.enabled': false };
        const { subsystems, postMessage } = createFakeSubsystems(defaults);

        dispatch(
            {
                type: EngineChannel.ReadProperties,
                correlationId: 'corr-properties-defaults',
            },
            subsystems,
        );

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ReadPropertiesResult,
            correlationId: 'corr-properties-defaults',
            properties: { loadedKey: 'loadedValue' },
            defaults,
        });
    });

    it('routes SaveProperties and posts ok:true result', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();

        const message: EngineSaveProperties = {
            type: EngineChannel.SaveProperties,
            correlationId: 'corr-9',
            properties: { key: 'value' },
        };
        dispatch(message, subsystems);

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SavePropertiesResult,
            correlationId: 'corr-9',
            ok: true,
            applied: {},
            restartRequired: [],
        });
        expect(engine.applyProperties).toHaveBeenCalledWith(message.properties);
    });

    it('returns a validation failure before attempting a durable write', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        const validation = {
            ok: false as const,
            kind: 'validation' as const,
            error: 'notifyOnWorkflowError: expected boolean',
            issues: ['notifyOnWorkflowError: expected boolean'],
        };
        engine.validateProperties.mockReturnValue(validation);

        dispatch(
            {
                type: EngineChannel.SaveProperties,
                correlationId: 'corr-properties-validation-failed',
                properties: { notifyOnWorkflowError: 'no' },
            },
            subsystems,
        );

        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SavePropertiesResult,
            correlationId: 'corr-properties-validation-failed',
            ...validation,
        });
        expect(writePropertiesFileMock).not.toHaveBeenCalled();
        expect(engine.applyProperties).not.toHaveBeenCalled();
    });

    it('returns a diagnostic when saving properties fails', () => {
        const { subsystems, postMessage, log, engine } = createFakeSubsystems();
        const diagnostic = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: '/fake/properties.json',
            message: 'disk full',
        } as const;
        writePropertiesFileMock.mockReturnValue(Either.left(diagnostic));

        dispatch(
            {
                type: EngineChannel.SaveProperties,
                correlationId: 'corr-properties-save-failed',
                properties: { key: 'value' },
            },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to save properties:'));
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SavePropertiesResult,
            correlationId: 'corr-properties-save-failed',
            ok: false,
            kind: 'write',
            error: expect.stringContaining('disk full'),
            diagnostic,
        });
        expect(engine.applyProperties).not.toHaveBeenCalled();
    });

    it('awaits shutdown before acknowledging the Engine shutdown command', async () => {
        const { subsystems, postMessage } = createFakeSubsystems();
        const shutdown = vi.fn().mockResolvedValue(undefined);
        (subsystems as unknown as { shutdown: typeof shutdown }).shutdown = shutdown;

        await dispatch(
            { type: EngineChannel.Shutdown, correlationId: 'corr-shutdown' },
            subsystems,
        );

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ShutdownResult,
            correlationId: 'corr-shutdown',
            ok: true,
        });
    });

    it('reports shutdown failures to the Engine channel', async () => {
        const { subsystems, postMessage, log } = createFakeSubsystems();
        const shutdown = vi.fn().mockRejectedValue(new Error('shutdown failed'));
        (subsystems as unknown as { shutdown: typeof shutdown }).shutdown = shutdown;

        await dispatch(
            { type: EngineChannel.Shutdown, correlationId: 'corr-shutdown-failed' },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith('[error] engine shutdown failed: shutdown failed');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ShutdownResult,
            correlationId: 'corr-shutdown-failed',
            ok: false,
        });
    });

    it('routes ReadWorkflowState and posts entries', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        engine.workflowStateStore.listKeys.mockReturnValue([
            { key: 'k1', type: 'string', value: 'v1' },
        ]);

        const message: EngineReadWorkflowState = {
            type: EngineChannel.ReadWorkflowState,
            correlationId: 'corr-10',
            workflowId: 'wf-1',
        };
        dispatch(message, subsystems);

        expect(engine.workflowStateStore.listKeys).toHaveBeenCalledWith('wf-1');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.ReadWorkflowStateResult,
            correlationId: 'corr-10',
            entries: [{ key: 'k1', type: 'string', value: 'v1' }],
        });
    });

    it('routes SetWorkflowStateKey and posts ok result', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();

        const message: EngineSetWorkflowStateKey = {
            type: EngineChannel.SetWorkflowStateKey,
            correlationId: 'corr-11',
            workflowId: 'wf-1',
            key: 'k1',
            value: 'v1',
        };
        dispatch(message, subsystems);

        expect(engine.workflowStateStore.setKey).toHaveBeenCalledWith('wf-1', 'k1', 'v1');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetWorkflowStateKeyResult,
            correlationId: 'corr-11',
            ok: true,
        });
    });

    it('routes DeleteWorkflowStateKey and posts ok result', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();

        const message: EngineDeleteWorkflowStateKey = {
            type: EngineChannel.DeleteWorkflowStateKey,
            correlationId: 'corr-12',
            workflowId: 'wf-1',
            key: 'k1',
        };
        dispatch(message, subsystems);

        expect(engine.workflowStateStore.deleteKey).toHaveBeenCalledWith('wf-1', 'k1');
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.DeleteWorkflowStateKeyResult,
            correlationId: 'corr-12',
            ok: true,
        });
    });

    it('FireTestEvent posts an error log when engine.execute rejects', async () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        engine.execute.mockRejectedValue(new Error('test error'));

        await dispatch(
            { type: EngineChannel.FireTestEvent, correlationId: 'corr-test-error' },
            subsystems,
        );

        await vi.waitFor(() => {
            expect(postMessage).toHaveBeenCalledWith({
                type: EngineChannel.Log,
                line: '[error] engine.execute failed: test error',
            });
        });
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.FireTestEventResult,
            correlationId: 'corr-test-error',
            ok: false,
            error: 'test error',
        });
    });

    it('FireManualTrigger posts an error log when engine.execute rejects', async () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        engine.execute.mockRejectedValue(new Error('manual trigger error'));
        const pipeline = { id: 'p-1' } as CompiledPipeline;

        await dispatch(
            {
                type: EngineChannel.FireManualTrigger,
                correlationId: 'corr-manual-error',
                pipeline,
            },
            subsystems,
        );

        await vi.waitFor(() => {
            expect(postMessage).toHaveBeenCalledWith({
                type: EngineChannel.Log,
                line: '[error] manual trigger execution failed: manual trigger error',
            });
        });
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.FireManualTriggerResult,
            correlationId: 'corr-manual-error',
            ok: false,
            error: 'manual trigger error',
        });
    });
});
