import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import { Effect, Either, Match, Option } from 'effect';
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
    type EngineRetryWorkflow,
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineSetWorkflowStateKey,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
    type WorkerInbound,
} from '../shared/ipc-channels.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { Engine } from './engine.js';
import { updatePluginPermissions } from './node-plugin-loader.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';
import type { WorkflowActivator } from './workflow-activator.js';
import type { WorkflowLifecycle } from './workflow-lifecycle.js';
import type { WorkflowStore } from './workflow-store.js';
import { isWorkflowTopologyError } from './workflow-topology-error.js';

export interface DispatchSubsystems {
    readonly postMessage: (msg: unknown) => void;
    readonly engine: Engine;
    readonly store: WorkflowStore;
    readonly activator: WorkflowActivator;
    readonly lifecycle?: WorkflowLifecycle;
    readonly broadcastWorkflowsList: () => void;
    readonly log: (message: string) => void;
    readonly propertiesPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    if (subsystems.lifecycle) {
        const before = subsystems.store.getSummary(message.id);
        const toggled = subsystems.lifecycle.toggle(message.id);
        if (Option.isSome(before) && Option.isSome(toggled)) {
            subsystems.log(
                `"${before.value.name}" ${toggled.value.enabled ? 'enabled' : 'disabled'}`,
            );
        }
        subsystems.broadcastWorkflowsList();
        subsystems.postMessage({
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: message.correlationId,
            summary: Option.getOrUndefined(toggled),
        });
        return;
    }

    const before = subsystems.store.get(message.id);
    const toggled = subsystems.store.toggle(message.id);
    if (Option.isSome(before) && Option.isSome(toggled)) {
        subsystems.log(`"${before.value.name}" ${toggled.value.enabled ? 'enabled' : 'disabled'}`);
        if (toggled.value.enabled) {
            subsystems.activator.activate(message.id);
        } else {
            subsystems.activator.deactivate(message.id);
        }
    }
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.ToggleWorkflowResult,
        correlationId: message.correlationId,
        summary: Option.getOrUndefined(toggled),
    });
}

function handleRetryWorkflow(message: EngineRetryWorkflow, subsystems: DispatchSubsystems): void {
    const summary = subsystems.lifecycle
        ? subsystems.lifecycle.retry(message.id)
        : Option.none<ReturnType<WorkflowStore['save']>>();
    if (Option.isSome(summary)) {
        subsystems.log(`Retrying workflow "${summary.value.name}" (${summary.value.id})`);
    }
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.RetryWorkflowResult,
        correlationId: message.correlationId,
        summary: Option.getOrUndefined(summary),
    });
}

function handleCreateWorkflow(message: EngineCreateWorkflow, subsystems: DispatchSubsystems): void {
    let summary: ReturnType<WorkflowStore['create']>;
    try {
        summary = subsystems.store.create(message.name, message.pipeline, message.positions);
    } catch (err) {
        if (!isWorkflowTopologyError(err)) throw err;
        subsystems.log(`Could not create workflow "${message.name}": ${err.message}`);
        subsystems.postMessage({
            type: EngineChannel.CreateWorkflowResult,
            correlationId: message.correlationId,
            error: err.message,
            diagnostics: err.diagnostics,
        });
        return;
    }
    subsystems.log(`Created workflow "${message.name}" (${summary.id})`);
    subsystems.broadcastWorkflowsList();
    subsystems.postMessage({
        type: EngineChannel.CreateWorkflowResult,
        correlationId: message.correlationId,
        summary,
    });
}

function handleUpdateWorkflow(message: EngineUpdateWorkflow, subsystems: DispatchSubsystems): void {
    const existed = Option.isSome(subsystems.store.get(message.id));
    let summary: ReturnType<WorkflowStore['save']>;
    try {
        summary = subsystems.lifecycle
            ? subsystems.lifecycle.update(message.id, () =>
                  subsystems.store.save(
                      message.id,
                      message.name,
                      message.pipeline,
                      message.positions,
                  ),
              )
            : subsystems.store.save(message.id, message.name, message.pipeline, message.positions);
    } catch (err) {
        if (!isWorkflowTopologyError(err)) throw err;
        subsystems.log(`Could not update workflow "${message.name}": ${err.message}`);
        subsystems.postMessage({
            type: EngineChannel.UpdateWorkflowResult,
            correlationId: message.correlationId,
            error: err.message,
            diagnostics: err.diagnostics,
        });
        return;
    }
    if (existed) {
        if (!subsystems.lifecycle) subsystems.activator.deactivate(message.id);
        subsystems.log(`Updated workflow "${message.name}" (${summary.id})`);
        if (!subsystems.lifecycle && summary.enabled) {
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
    if (subsystems.lifecycle) {
        subsystems.lifecycle.disable(message.id);
    } else {
        subsystems.activator.deactivate(message.id);
    }
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
    if (Option.isSome(data)) {
        subsystems.postMessage({
            type: EngineChannel.GetWorkflowResult,
            correlationId: message.correlationId,
            found: true,
            name: data.value.name,
            pipeline: data.value.pipeline,
            positions: data.value.positions,
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
    const current = readPropertiesFile(subsystems.propertiesPath).pipe(
        Effect.catchAll(() => Effect.succeed({})),
        Effect.runSync,
    );
    const properties = isRecord(current) ? current : {};
    subsystems.postMessage({
        type: EngineChannel.ReadPropertiesResult,
        correlationId: message.correlationId,
        properties,
    });
}

function handleSaveProperties(message: EngineSaveProperties, subsystems: DispatchSubsystems): void {
    const result = writePropertiesFile(subsystems.propertiesPath, message.properties);
    if (Either.isLeft(result)) {
        subsystems.log(`Failed to save properties: ${result.left}`);
    }
    subsystems.postMessage({
        type: EngineChannel.SavePropertiesResult,
        correlationId: message.correlationId,
        ok: Either.isRight(result),
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
    Match.value(message).pipe(
        Match.when({ type: EngineChannel.Ping }, (msg) => handlePing(msg, subsystems)),
        Match.when({ type: EngineChannel.FireTestEvent }, () => handleFireTestEvent(subsystems)),
        Match.when({ type: EngineChannel.FireManualTrigger }, (msg) =>
            handleFireManualTrigger(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.ToggleWorkflow }, (msg) =>
            handleToggleWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.RetryWorkflow }, (msg) =>
            handleRetryWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.CreateWorkflow }, (msg) =>
            handleCreateWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.UpdateWorkflow }, (msg) =>
            handleUpdateWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.DeleteWorkflow }, (msg) =>
            handleDeleteWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.GetWorkflow }, (msg) =>
            handleGetWorkflow(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.ListPlugins }, (msg) =>
            handleListPlugins(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.SetPermissionOverride }, (msg) =>
            handleSetPermissionOverride(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.ReadProperties }, (msg) =>
            handleReadProperties(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.SaveProperties }, (msg) =>
            handleSaveProperties(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.ReadWorkflowState }, (msg) =>
            handleReadWorkflowState(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.SetWorkflowStateKey }, (msg) =>
            handleSetWorkflowStateKey(msg, subsystems),
        ),
        Match.when({ type: EngineChannel.DeleteWorkflowStateKey }, (msg) =>
            handleDeleteWorkflowStateKey(msg, subsystems),
        ),
        Match.exhaustive,
    );
}
