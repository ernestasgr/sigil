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
    type EnginePong,
    type EngineReadProperties,
    type EngineReadWorkflowState,
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineSetWorkflowStateKey,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
    type WorkerInbound,
} from '../shared/ipc-channels.js';
import { assertNever } from '../shared/assert-never.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { Engine } from './engine.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';
import { updatePluginPermissions } from './node-plugin-loader.js';
import type { WorkflowActivator } from './workflow-activator.js';
import type { WorkflowStore } from './workflow-store.js';

export interface DispatchSubsystems {
    readonly postMessage: (msg: unknown) => void;
    readonly engine: Engine;
    readonly store: WorkflowStore;
    readonly activator: WorkflowActivator;
    readonly broadcastWorkflowsList: () => void;
    readonly log: (message: string) => void;
    readonly propertiesPath: string;
}

function handlePing(message: EnginePing, subsystems: DispatchSubsystems): void {
    const pong: EnginePong = {
        id: message.id,
        type: EngineChannel.Pong,
        receivedAt: Date.now(),
    };
    subsystems.postMessage(pong);
}

function handleFireTestEvent(subsystems: DispatchSubsystems): void {
    void subsystems.engine.execute(sampleManualTriggerToLog).catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        subsystems.postMessage({
            type: EngineChannel.Log,
            line: `[error] engine.execute failed: ${detail}`,
        });
    });
}

function handleFireManualTrigger(
    message: EngineFireManualTrigger,
    subsystems: DispatchSubsystems,
): void {
    void subsystems.engine.execute(message.pipeline).catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        subsystems.postMessage({
            type: EngineChannel.Log,
            line: `[error] manual trigger execution failed: ${detail}`,
        });
    });
}

function handleToggleWorkflow(message: EngineToggleWorkflow, subsystems: DispatchSubsystems): void {
    const before = subsystems.store.get(message.id);
    const toggled = subsystems.store.toggle(message.id);
    if (before && toggled) {
        subsystems.log(`"${before.name}" ${toggled.enabled ? 'enabled' : 'disabled'}`);
        if (toggled.enabled) {
            subsystems.activator.activate(message.id);
        } else {
            subsystems.activator.deactivate(message.id);
        }
    }
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.ToggleWorkflowResult,
        correlationId: message.correlationId,
        summary: toggled,
    });
}

function handleCreateWorkflow(message: EngineCreateWorkflow, subsystems: DispatchSubsystems): void {
    const summary = subsystems.store.create(message.name, message.pipeline, message.positions);
    subsystems.log(`Created workflow "${message.name}" (${summary.id})`);
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.CreateWorkflowResult,
        correlationId: message.correlationId,
        summary,
    });
}

function handleUpdateWorkflow(message: EngineUpdateWorkflow, subsystems: DispatchSubsystems): void {
    subsystems.activator.deactivate(message.id);
    const existed = subsystems.store.get(message.id) !== null;
    const summary = subsystems.store.save(
        message.id,
        message.name,
        message.pipeline,
        message.positions,
    );
    if (existed) {
        subsystems.log(`Updated workflow "${message.name}" (${summary.id})`);
        if (summary.enabled) {
            subsystems.activator.activate(message.id);
        }
    } else {
        subsystems.log(
            `Created workflow "${message.name}" via update for missing id (${summary.id})`,
        );
    }
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.UpdateWorkflowResult,
        correlationId: message.correlationId,
        summary,
    });
}

function handleDeleteWorkflow(message: EngineDeleteWorkflow, subsystems: DispatchSubsystems): void {
    subsystems.activator.deactivate(message.id);
    const removed = subsystems.store.remove(message.id);
    if (removed) {
        subsystems.log(`Deleted workflow (${message.id})`);
    }
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.DeleteWorkflowResult,
        correlationId: message.correlationId,
        success: removed,
    });
}

function handleGetWorkflow(message: EngineGetWorkflow, subsystems: DispatchSubsystems): void {
    const data = subsystems.store.get(message.id);
    if (data) {
        subsystems.postMessage({
            type: EngineChannel.GetWorkflowResult,
            correlationId: message.correlationId,
            found: true,
            name: data.name,
            pipeline: data.pipeline,
            positions: data.positions,
        });
    } else {
        subsystems.postMessage({
            type: EngineChannel.GetWorkflowResult,
            correlationId: message.correlationId,
            found: false,
            error: `Workflow not found: ${message.id}`,
        });
    }
}

function handleListPlugins(message: EngineListPlugins, subsystems: DispatchSubsystems): void {
    const manifests = subsystems.engine.registry.all();
    const plugins: readonly PluginInfo[] = manifests.map((manifest) => ({
        manifest,
        grantedPermissions: subsystems.engine.permissionOverrides.has(manifest.id)
            ? subsystems.engine.permissionOverrides.get(manifest.id)
            : manifest.permissions,
    }));
    subsystems.postMessage({
        type: EngineChannel.ListPluginsResult,
        correlationId: message.correlationId,
        plugins,
    });
}

function handleSetPermissionOverride(
    message: EngineSetPermissionOverride,
    subsystems: DispatchSubsystems,
): void {
    subsystems.engine.permissionOverrides.set(message.pluginId, message.overrides);
    updatePluginPermissions(message.pluginId, message.overrides);
    subsystems.postMessage({
        type: EngineChannel.SetPermissionOverrideResult,
        correlationId: message.correlationId,
        ok: true,
    });
}

function handleReadProperties(message: EngineReadProperties, subsystems: DispatchSubsystems): void {
    const current = readPropertiesFile(subsystems.propertiesPath);
    const properties =
        current && typeof current === 'object' && !Array.isArray(current)
            ? (current as Record<string, unknown>)
            : {};
    subsystems.postMessage({
        type: EngineChannel.ReadPropertiesResult,
        correlationId: message.correlationId,
        properties,
    });
}

function handleSaveProperties(message: EngineSaveProperties, subsystems: DispatchSubsystems): void {
    const result = writePropertiesFile(subsystems.propertiesPath, message.properties);
    if (!result.ok) {
        subsystems.log(`Failed to save properties: ${result.error}`);
    }
    subsystems.postMessage({
        type: EngineChannel.SavePropertiesResult,
        correlationId: message.correlationId,
        ok: result.ok,
    });
}

function handleReadWorkflowState(
    message: EngineReadWorkflowState,
    subsystems: DispatchSubsystems,
): void {
    const entries = subsystems.engine.workflowStateStore.listKeys(message.workflowId);
    subsystems.postMessage({
        type: EngineChannel.ReadWorkflowStateResult,
        correlationId: message.correlationId,
        entries,
    });
}

function handleSetWorkflowStateKey(
    message: EngineSetWorkflowStateKey,
    subsystems: DispatchSubsystems,
): void {
    subsystems.engine.workflowStateStore.setKey(message.workflowId, message.key, message.value);
    subsystems.postMessage({
        type: EngineChannel.SetWorkflowStateKeyResult,
        correlationId: message.correlationId,
        ok: true,
    });
}

function handleDeleteWorkflowStateKey(
    message: EngineDeleteWorkflowStateKey,
    subsystems: DispatchSubsystems,
): void {
    subsystems.engine.workflowStateStore.deleteKey(message.workflowId, message.key);
    subsystems.postMessage({
        type: EngineChannel.DeleteWorkflowStateKeyResult,
        correlationId: message.correlationId,
        ok: true,
    });
}

export function dispatch(message: WorkerInbound, subsystems: DispatchSubsystems): void {
    switch (message.type) {
        case EngineChannel.Ping:
            return handlePing(message, subsystems);
        case EngineChannel.FireTestEvent:
            return handleFireTestEvent(subsystems);
        case EngineChannel.FireManualTrigger:
            return handleFireManualTrigger(message, subsystems);
        case EngineChannel.ToggleWorkflow:
            return handleToggleWorkflow(message, subsystems);
        case EngineChannel.CreateWorkflow:
            return handleCreateWorkflow(message, subsystems);
        case EngineChannel.UpdateWorkflow:
            return handleUpdateWorkflow(message, subsystems);
        case EngineChannel.DeleteWorkflow:
            return handleDeleteWorkflow(message, subsystems);
        case EngineChannel.GetWorkflow:
            return handleGetWorkflow(message, subsystems);
        case EngineChannel.ListPlugins:
            return handleListPlugins(message, subsystems);
        case EngineChannel.SetPermissionOverride:
            return handleSetPermissionOverride(message, subsystems);
        case EngineChannel.ReadProperties:
            return handleReadProperties(message, subsystems);
        case EngineChannel.SaveProperties:
            return handleSaveProperties(message, subsystems);
        case EngineChannel.ReadWorkflowState:
            return handleReadWorkflowState(message, subsystems);
        case EngineChannel.SetWorkflowStateKey:
            return handleSetWorkflowStateKey(message, subsystems);
        case EngineChannel.DeleteWorkflowStateKey:
            return handleDeleteWorkflowStateKey(message, subsystems);
        default:
            return assertNever(message);
    }
}
