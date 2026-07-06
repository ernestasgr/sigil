import { describe, expect, it, vi } from 'vitest';

import type { CompiledPipeline } from '@sigil/schema';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';

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
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineSetWorkflowStateKey,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
} from '../shared/ipc-channels.js';

import { dispatch, type DispatchSubsystems } from './dispatch.js';

function createFakeSubsystems(): {
    subsystems: DispatchSubsystems;
    postMessage: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
    broadcastWorkflowsList: ReturnType<typeof vi.fn>;
    engine: {
        execute: ReturnType<typeof vi.fn>;
        registry: { all: ReturnType<typeof vi.fn> };
        permissionOverrides: {
            has: ReturnType<typeof vi.fn>;
            get: ReturnType<typeof vi.fn>;
            set: ReturnType<typeof vi.fn>;
        };
        workflowStateStore: {
            listKeys: ReturnType<typeof vi.fn>;
            setKey: ReturnType<typeof vi.fn>;
            deleteKey: ReturnType<typeof vi.fn>;
        };
    };
    store: {
        get: ReturnType<typeof vi.fn>;
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
    const postMessage = vi.fn();
    const log = vi.fn();
    const broadcastWorkflowsList = vi.fn();
    const execute = vi.fn().mockResolvedValue(undefined);
    const registryAll = vi.fn().mockReturnValue([]);
    const permissionHas = vi.fn();
    const permissionGet = vi.fn();
    const permissionSet = vi.fn();
    const listKeys = vi.fn().mockReturnValue([]);
    const setKey = vi.fn();
    const deleteKey = vi.fn();
    const storeGet = vi.fn();
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
                registry: { all: registryAll },
                permissionOverrides: {
                    has: permissionHas,
                    get: permissionGet,
                    set: permissionSet,
                },
                workflowStateStore: {
                    listKeys,
                    setKey,
                    deleteKey,
                },
            } as unknown as DispatchSubsystems['engine'],
            store: {
                get: storeGet,
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
            registry: { all: registryAll },
            permissionOverrides: { has: permissionHas, get: permissionGet, set: permissionSet },
            workflowStateStore: { listKeys, setKey, deleteKey },
        },
        store: {
            get: storeGet,
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

        const message: EnginePing = { id: 'test-1', type: EngineChannel.Ping };
        dispatch(message, subsystems);

        expect(postMessage).toHaveBeenCalledTimes(1);
        const call = postMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call).toMatchObject({ type: EngineChannel.Pong, id: 'test-1' });
        expect(typeof (call as { receivedAt: number }).receivedAt).toBe('number');
    });

    it('routes FireTestEvent to handleFireTestEvent which calls engine.execute with the sample pipeline', () => {
        const { subsystems, engine } = createFakeSubsystems();

        dispatch({ type: EngineChannel.FireTestEvent }, subsystems);

        expect(engine.execute).toHaveBeenCalledTimes(1);
        expect(engine.execute).toHaveBeenCalledWith(sampleManualTriggerToLog);
    });

    it('routes FireManualTrigger to handleFireManualTrigger which calls engine.execute with the given pipeline', () => {
        const { subsystems, engine } = createFakeSubsystems();
        const pipeline = { id: 'p-1' } as CompiledPipeline;

        const message: EngineFireManualTrigger = {
            type: EngineChannel.FireManualTrigger,
            pipeline,
        };
        dispatch(message, subsystems);

        expect(engine.execute).toHaveBeenCalledTimes(1);
        expect(engine.execute).toHaveBeenCalledWith(pipeline);
    });

    it('routes ToggleWorkflow and calls store.get, store.toggle, activator, broadcast, and posts result', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log } =
            createFakeSubsystems();
        const before = { id: 'wf-1', name: 'Test WF', enabled: false };
        const toggled = { id: 'wf-1', name: 'Test WF', enabled: true };
        store.get.mockReturnValue(before);
        store.toggle.mockReturnValue(toggled);

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
        store.get.mockReturnValue(before);
        store.toggle.mockReturnValue(toggled);

        dispatch(
            { type: EngineChannel.ToggleWorkflow, correlationId: 'c-1', id: 'wf-1' },
            subsystems,
        );

        expect(log).toHaveBeenCalledWith('"Test WF" disabled');
        expect(activator.deactivate).toHaveBeenCalledWith('wf-1');
        expect(activator.activate).not.toHaveBeenCalled();
    });

    it('routes ToggleWorkflow and does nothing extra when toggle returns null', () => {
        const { subsystems, store, activator, log } = createFakeSubsystems();
        store.get.mockReturnValue(null);
        store.toggle.mockReturnValue(null);

        dispatch(
            { type: EngineChannel.ToggleWorkflow, correlationId: 'c-1', id: 'wf-1' },
            subsystems,
        );

        expect(log).not.toHaveBeenCalled();
        expect(activator.activate).not.toHaveBeenCalled();
        expect(activator.deactivate).not.toHaveBeenCalled();
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

    it('routes UpdateWorkflow for an existing workflow', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log } =
            createFakeSubsystems();
        const existing = { id: 'wf-1', name: 'Old', enabled: true };
        const summary = { id: 'wf-1', name: 'Updated', enabled: true };
        store.get.mockReturnValue(existing);
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
        store.get.mockReturnValue({ id: 'wf-1', name: 'Old', enabled: false });
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
        store.get.mockReturnValue(null);
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

    it('routes DeleteWorkflow and calls remove, deactivates, broadcasts, and posts result', () => {
        const { subsystems, postMessage, store, activator, broadcastWorkflowsList, log } =
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
        expect(log).toHaveBeenCalledWith('Deleted workflow (wf-1)');
        expect(broadcastWorkflowsList).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.DeleteWorkflowResult,
            correlationId: 'corr-4',
            success: true,
        });
    });

    it('routes DeleteWorkflow and does not log when remove returns false', () => {
        const { subsystems, store, log } = createFakeSubsystems();
        store.remove.mockReturnValue(false);

        dispatch(
            { type: EngineChannel.DeleteWorkflow, correlationId: 'c', id: 'wf-1' },
            subsystems,
        );

        expect(log).not.toHaveBeenCalled();
    });

    it('routes GetWorkflow and posts found result when workflow exists', () => {
        const { subsystems, postMessage, store } = createFakeSubsystems();
        store.get.mockReturnValue({
            name: 'My WF',
            pipeline: { id: 'p-1' } as CompiledPipeline,
            positions: { node1: { x: 1, y: 2 } },
        });

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
        store.get.mockReturnValue(null);

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

    it('routes ListPlugins and uses overridden permissions when present', () => {
        const { subsystems, engine } = createFakeSubsystems();
        const manifest = { id: 'plugin-a', name: 'A', version: '1.0.0', permissions: [] };
        engine.registry.all.mockReturnValue([manifest]);
        engine.permissionOverrides.has.mockReturnValue(true);
        engine.permissionOverrides.get.mockReturnValue([{ capability: 'custom' }]);

        dispatch({ type: EngineChannel.ListPlugins, correlationId: 'c' }, subsystems);

        expect(engine.permissionOverrides.get).toHaveBeenCalledWith('plugin-a');
    });

    it('routes SetPermissionOverride and posts ok result', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();

        const message: EngineSetPermissionOverride = {
            type: EngineChannel.SetPermissionOverride,
            correlationId: 'corr-7',
            pluginId: 'plugin-a',
            overrides: [],
        };
        dispatch(message, subsystems);

        expect(engine.permissionOverrides.set).toHaveBeenCalledWith('plugin-a', []);
        expect(postMessage).toHaveBeenCalledWith({
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: 'corr-7',
            ok: true,
        });
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
            properties: expect.any(Object),
        });
    });

    it('routes SaveProperties and posts a result with the correct type and correlationId', () => {
        const { subsystems, postMessage } = createFakeSubsystems();

        const message: EngineSaveProperties = {
            type: EngineChannel.SaveProperties,
            correlationId: 'corr-9',
            properties: { key: 'value' },
        };
        dispatch(message, subsystems);

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: EngineChannel.SavePropertiesResult,
                correlationId: 'corr-9',
            }),
        );
    });

    it('routes ReadWorkflowState and posts entries', () => {
        const { subsystems, postMessage, engine } = createFakeSubsystems();
        engine.workflowStateStore.listKeys.mockReturnValue([{ key: 'k1', value: 'v1' }]);

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
            entries: [{ key: 'k1', value: 'v1' }],
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

        dispatch({ type: EngineChannel.FireTestEvent }, subsystems);

        await vi.waitFor(() => {
            expect(postMessage).toHaveBeenCalledWith({
                type: EngineChannel.Log,
                line: '[error] engine.execute failed: test error',
            });
        });
    });
});
