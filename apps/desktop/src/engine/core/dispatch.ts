import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import { Effect, Either, Match, Option } from 'effect';
import type {
    EngineCommandName,
    EngineCommandRequest,
    EngineRequest,
    EngineResponse,
} from '../../shared/command-contracts.js';
import type { EngineDiagnosticPayload } from '../../shared/event-payload-schemas.js';
import { EngineChannel } from '../../shared/ipc-channels.js';
import {
    formatPersistenceDiagnostic,
    isExpectedMissingFileDiagnostic,
} from '../../shared/persistence.js';
import type { PluginInfo } from '../../shared/plugin-info.js';
import { effectiveCapabilityView } from '../persistence/capability-broker.js';
import type { WorkflowActivator } from '../workflow/workflow-activator.js';
import type { WorkflowLifecycle } from '../workflow/workflow-lifecycle.js';
import type { WorkflowStore } from '../workflow/workflow-store.js';
import { isWorkflowPersistenceError } from '../workflow/workflow-store.js';
import { isWorkflowTopologyError } from '../workflow/workflow-topology-error.js';
import type { Engine } from './engine.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';

export interface DispatchSubsystems {
    readonly postMessage: (msg: unknown) => void;
    readonly engine: Engine;
    readonly store: WorkflowStore;
    readonly activator: WorkflowActivator;
    readonly lifecycle?: WorkflowLifecycle;
    readonly shutdown?: () => Promise<void>;
    readonly broadcastWorkflowsList: () => void;
    readonly log: (message: string, context?: Omit<EngineDiagnosticPayload, 'message'>) => void;
    readonly propertiesPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postCommandResponse<C extends EngineCommandName>(
    _command: C,
    response: EngineResponse<C>,
    subsystems: DispatchSubsystems,
): void {
    // The response type is selected from the same command key as the request;
    // runtime validation belongs at the worker receive and Engine-client receive sites.
    subsystems.postMessage(response);
}

function handlePing(message: EngineRequest<'ping'>, subsystems: DispatchSubsystems): void {
    const pong: EngineResponse<'ping'> = {
        correlationId: message.correlationId,
        type: EngineChannel.Pong,
        receivedAt: Date.now(),
    };
    postCommandResponse('ping', pong, subsystems);
}

async function handleFireTestEvent(
    message: EngineRequest<'fireTestEvent'>,
    subsystems: DispatchSubsystems,
): Promise<void> {
    try {
        await subsystems.engine.execute(sampleManualTriggerToLog);
        postCommandResponse(
            'fireTestEvent',
            {
                type: EngineChannel.FireTestEventResult,
                correlationId: message.correlationId,
                ok: true,
            },
            subsystems,
        );
    } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        subsystems.log(`[error] engine.execute failed: ${detail}`, {
            source: 'worker',
            kind: 'execution-dispatch',
            outcome: 'failed',
        });
        subsystems.postMessage({
            type: EngineChannel.Log,
            line: `[error] engine.execute failed: ${detail}`,
        });
        postCommandResponse(
            'fireTestEvent',
            {
                type: EngineChannel.FireTestEventResult,
                correlationId: message.correlationId,
                ok: false,
                error: detail,
            },
            subsystems,
        );
    }
}

async function handleFireManualTrigger(
    message: EngineRequest<'fireManualTrigger'>,
    subsystems: DispatchSubsystems,
): Promise<void> {
    try {
        await subsystems.engine.execute(message.pipeline);
        postCommandResponse(
            'fireManualTrigger',
            {
                type: EngineChannel.FireManualTriggerResult,
                correlationId: message.correlationId,
                ok: true,
            },
            subsystems,
        );
    } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        subsystems.log(`[error] manual trigger execution failed: ${detail}`, {
            source: 'worker',
            kind: 'execution-dispatch',
            outcome: 'failed',
        });
        subsystems.postMessage({
            type: EngineChannel.Log,
            line: `[error] manual trigger execution failed: ${detail}`,
        });
        postCommandResponse(
            'fireManualTrigger',
            {
                type: EngineChannel.FireManualTriggerResult,
                correlationId: message.correlationId,
                ok: false,
                error: detail,
            },
            subsystems,
        );
    }
}

function handleToggleWorkflow(
    message: EngineRequest<'toggleWorkflow'>,
    subsystems: DispatchSubsystems,
): void {
    try {
        if (subsystems.lifecycle) {
            const before = subsystems.store.getSummary(message.id);
            const toggled = subsystems.lifecycle.toggle(message.id);
            if (Option.isSome(before) && Option.isSome(toggled)) {
                subsystems.log(
                    `"${before.value.name}" ${toggled.value.enabled ? 'enabled' : 'disabled'}`,
                );
            }
            subsystems.broadcastWorkflowsList();
            postCommandResponse(
                'toggleWorkflow',
                {
                    type: EngineChannel.ToggleWorkflowResult,
                    correlationId: message.correlationId,
                    summary: Option.getOrElse(() => null)(toggled),
                },
                subsystems,
            );
            return;
        }

        const before = subsystems.store.get(message.id);
        const toggled = subsystems.store.toggle(message.id);
        if (Option.isSome(before) && Option.isSome(toggled)) {
            subsystems.log(
                `"${before.value.name}" ${toggled.value.enabled ? 'enabled' : 'disabled'}`,
            );
            if (toggled.value.enabled) {
                subsystems.activator.activate(message.id);
            } else {
                subsystems.activator.deactivate(message.id);
            }
        }
        subsystems.broadcastWorkflowsList();
        postCommandResponse(
            'toggleWorkflow',
            {
                type: EngineChannel.ToggleWorkflowResult,
                correlationId: message.correlationId,
                summary: Option.getOrElse(() => null)(toggled),
            },
            subsystems,
        );
    } catch (error) {
        if (!isWorkflowPersistenceError(error)) throw error;
        subsystems.log(formatPersistenceDiagnostic(error.diagnostic));
        postCommandResponse(
            'toggleWorkflow',
            {
                type: EngineChannel.ToggleWorkflowResult,
                correlationId: message.correlationId,
                summary: null,
                error: error.message,
                diagnostics: error.diagnostics,
            },
            subsystems,
        );
    }
}

function handleRetryWorkflow(
    message: EngineRequest<'retryWorkflow'>,
    subsystems: DispatchSubsystems,
): void {
    try {
        const summary = subsystems.lifecycle
            ? subsystems.lifecycle.retry(message.id)
            : Option.none<ReturnType<WorkflowStore['save']>>();
        if (Option.isSome(summary)) {
            subsystems.log(`Retrying workflow "${summary.value.name}" (${summary.value.id})`);
        }
        subsystems.broadcastWorkflowsList();
        postCommandResponse(
            'retryWorkflow',
            {
                type: EngineChannel.RetryWorkflowResult,
                correlationId: message.correlationId,
                summary: Option.getOrElse(() => null)(summary),
            },
            subsystems,
        );
    } catch (error) {
        if (!isWorkflowPersistenceError(error)) throw error;
        subsystems.log(formatPersistenceDiagnostic(error.diagnostic));
        postCommandResponse(
            'retryWorkflow',
            {
                type: EngineChannel.RetryWorkflowResult,
                correlationId: message.correlationId,
                summary: null,
                error: error.message,
                diagnostics: error.diagnostics,
            },
            subsystems,
        );
    }
}

function handleCreateWorkflow(
    message: EngineRequest<'createWorkflow'>,
    subsystems: DispatchSubsystems,
): void {
    let summary: ReturnType<WorkflowStore['create']>;
    try {
        summary = subsystems.store.create(message.name, message.pipeline, message.positions);
    } catch (error) {
        if (isWorkflowTopologyError(error)) {
            subsystems.log(`Could not create workflow "${message.name}": ${error.message}`);
            postCommandResponse(
                'createWorkflow',
                {
                    type: EngineChannel.CreateWorkflowResult,
                    correlationId: message.correlationId,
                    error: error.message,
                    diagnostics: error.diagnostics,
                },
                subsystems,
            );
            return;
        }
        if (isWorkflowPersistenceError(error)) {
            subsystems.log(formatPersistenceDiagnostic(error.diagnostic));
            postCommandResponse(
                'createWorkflow',
                {
                    type: EngineChannel.CreateWorkflowResult,
                    correlationId: message.correlationId,
                    error: error.message,
                    diagnostics: error.diagnostics,
                },
                subsystems,
            );
            return;
        }
        throw error;
    }
    subsystems.log(`Created workflow "${message.name}" (${summary.id})`);
    subsystems.broadcastWorkflowsList();
    postCommandResponse(
        'createWorkflow',
        {
            type: EngineChannel.CreateWorkflowResult,
            correlationId: message.correlationId,
            summary,
        },
        subsystems,
    );
}

async function handleUpdateWorkflow(
    message: EngineRequest<'updateWorkflow'>,
    subsystems: DispatchSubsystems,
): Promise<void> {
    const existed = Option.isSome(subsystems.store.get(message.id));
    let summary: ReturnType<WorkflowStore['save']>;
    try {
        summary = subsystems.lifecycle
            ? await subsystems.lifecycle.updateAndDrain(message.id, () =>
                  subsystems.store.save(
                      message.id,
                      message.name,
                      message.pipeline,
                      message.positions,
                  ),
              )
            : subsystems.store.save(message.id, message.name, message.pipeline, message.positions);
    } catch (error) {
        if (isWorkflowTopologyError(error)) {
            subsystems.log(`Could not update workflow "${message.name}": ${error.message}`);
            postCommandResponse(
                'updateWorkflow',
                {
                    type: EngineChannel.UpdateWorkflowResult,
                    correlationId: message.correlationId,
                    error: error.message,
                    diagnostics: error.diagnostics,
                },
                subsystems,
            );
            return;
        }
        if (isWorkflowPersistenceError(error)) {
            subsystems.log(formatPersistenceDiagnostic(error.diagnostic));
            postCommandResponse(
                'updateWorkflow',
                {
                    type: EngineChannel.UpdateWorkflowResult,
                    correlationId: message.correlationId,
                    error: error.message,
                    diagnostics: error.diagnostics,
                },
                subsystems,
            );
            return;
        }
        throw error;
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
    postCommandResponse(
        'updateWorkflow',
        {
            type: EngineChannel.UpdateWorkflowResult,
            correlationId: message.correlationId,
            summary,
        },
        subsystems,
    );
}

async function handleDeleteWorkflow(
    message: EngineRequest<'deleteWorkflow'>,
    subsystems: DispatchSubsystems,
): Promise<void> {
    try {
        if (subsystems.lifecycle) {
            subsystems.lifecycle.disable(message.id);
        } else {
            subsystems.activator.deactivate(message.id);
        }
        if (subsystems.activator.hasInFlightRuns?.(message.id)) {
            await subsystems.activator.waitForRuns(message.id);
        }
        const removed = subsystems.store.remove(message.id);
        if (removed) {
            subsystems.engine.workflowStateStore.deleteWorkflow(message.id);
            subsystems.log(`Deleted workflow (${message.id})`);
        }
        subsystems.broadcastWorkflowsList();
        if (removed) {
            postCommandResponse(
                'deleteWorkflow',
                {
                    type: EngineChannel.DeleteWorkflowResult,
                    correlationId: message.correlationId,
                    success: true,
                },
                subsystems,
            );
        } else {
            postCommandResponse(
                'deleteWorkflow',
                {
                    type: EngineChannel.DeleteWorkflowResult,
                    correlationId: message.correlationId,
                    success: false,
                },
                subsystems,
            );
        }
    } catch (error) {
        if (!isWorkflowPersistenceError(error)) throw error;
        subsystems.log(formatPersistenceDiagnostic(error.diagnostic));
        postCommandResponse(
            'deleteWorkflow',
            {
                type: EngineChannel.DeleteWorkflowResult,
                correlationId: message.correlationId,
                success: false,
                error: error.message,
                diagnostic: error.diagnostic,
            },
            subsystems,
        );
    }
}

async function handleShutdown(
    message: EngineRequest<'shutdown'>,
    subsystems: DispatchSubsystems,
): Promise<void> {
    let ok = true;
    try {
        await subsystems.shutdown?.();
    } catch (err) {
        ok = false;
        subsystems.log(
            `[error] engine shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    postCommandResponse(
        'shutdown',
        {
            type: EngineChannel.ShutdownResult,
            correlationId: message.correlationId,
            ok,
        },
        subsystems,
    );
}

function handleGetWorkflow(
    message: EngineRequest<'getWorkflow'>,
    subsystems: DispatchSubsystems,
): void {
    const data = subsystems.store.get(message.id);
    if (Option.isSome(data)) {
        postCommandResponse(
            'getWorkflow',
            {
                type: EngineChannel.GetWorkflowResult,
                correlationId: message.correlationId,
                found: true,
                name: data.value.name,
                pipeline: data.value.pipeline,
                positions: data.value.positions,
            },
            subsystems,
        );
    } else {
        postCommandResponse(
            'getWorkflow',
            {
                type: EngineChannel.GetWorkflowResult,
                correlationId: message.correlationId,
                found: false,
                error: `Workflow not found: ${message.id}`,
            },
            subsystems,
        );
    }
}

function handleListPlugins(
    message: EngineRequest<'listPlugins'>,
    subsystems: DispatchSubsystems,
): void {
    const manifests = subsystems.engine.registry.all();
    const plugins: readonly PluginInfo[] = manifests.map((manifest) => ({
        manifest,
        grantedPermissions: effectiveCapabilityView(
            manifest.permissions,
            subsystems.engine.permissionOverrides.has(manifest.id)
                ? subsystems.engine.permissionOverrides.get(manifest.id)
                : undefined,
        ),
    }));
    postCommandResponse(
        'listPlugins',
        {
            type: EngineChannel.ListPluginsResult,
            correlationId: message.correlationId,
            plugins,
        },
        subsystems,
    );
}

function handleSetPermissionOverride(
    message: EngineRequest<'setPermissionOverride'>,
    subsystems: DispatchSubsystems,
): void {
    if (!subsystems.engine.registry.has(message.pluginId)) {
        postCommandResponse(
            'setPermissionOverride',
            {
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: message.correlationId,
                ok: false,
                kind: 'domain',
                code: 'unknown_plugin',
                pluginId: message.pluginId,
                error: `Plugin "${message.pluginId}" is not registered in the Manifest Registry.`,
            },
            subsystems,
        );
        return;
    }

    const result = subsystems.engine.permissionOverrides.set(message.pluginId, message.overrides);
    if (Either.isLeft(result)) {
        const detail = formatPersistenceDiagnostic(result.left);
        subsystems.log(`Failed to save permission override: ${detail}`);
        postCommandResponse(
            'setPermissionOverride',
            {
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: message.correlationId,
                ok: false,
                kind: 'persistence',
                error: detail,
                diagnostic: result.left,
            },
            subsystems,
        );
        return;
    }
    const manifest = subsystems.engine.registry.get(message.pluginId);
    const effectivePermissions = Option.isSome(manifest)
        ? effectiveCapabilityView(manifest.value.permissions, message.overrides)
        : [];
    subsystems.engine.updatePluginPermissions?.(message.pluginId, effectivePermissions);
    postCommandResponse(
        'setPermissionOverride',
        {
            type: EngineChannel.SetPermissionOverrideResult,
            correlationId: message.correlationId,
            ok: true,
        },
        subsystems,
    );
}

function handleReadProperties(
    message: EngineRequest<'readProperties'>,
    subsystems: DispatchSubsystems,
): void {
    const current = readPropertiesFile(subsystems.propertiesPath).pipe(
        Effect.catchAll((error) => {
            if (!isExpectedMissingFileDiagnostic(error)) {
                subsystems.log(`Properties file diagnostic: ${formatPersistenceDiagnostic(error)}`);
            }
            return Effect.succeed({});
        }),
        Effect.runSync,
    );
    const properties = isRecord(current) ? current : {};
    const defaults = subsystems.engine.propertyRegistry?.defaults();
    postCommandResponse(
        'readProperties',
        {
            type: EngineChannel.ReadPropertiesResult,
            correlationId: message.correlationId,
            properties,
            ...(defaults === undefined ? {} : { defaults }),
        },
        subsystems,
    );
}

function handleSaveProperties(
    message: EngineRequest<'saveProperties'>,
    subsystems: DispatchSubsystems,
): void {
    const validation = subsystems.engine.validateProperties(message.properties);
    if (!validation.ok) {
        postCommandResponse(
            'saveProperties',
            {
                type: EngineChannel.SavePropertiesResult,
                correlationId: message.correlationId,
                ok: false,
                kind: 'validation',
                error: validation.error,
                issues: validation.issues,
            },
            subsystems,
        );
        return;
    }

    const result = writePropertiesFile(subsystems.propertiesPath, validation.properties);
    if (Either.isLeft(result)) {
        const detail = formatPersistenceDiagnostic(result.left);
        subsystems.log(`Failed to save properties: ${detail}`);
        postCommandResponse(
            'saveProperties',
            {
                type: EngineChannel.SavePropertiesResult,
                correlationId: message.correlationId,
                ok: false,
                kind: 'write',
                error: detail,
                diagnostic: result.left,
            },
            subsystems,
        );
        return;
    }

    const status = subsystems.engine.applyProperties(validation.properties);
    postCommandResponse(
        'saveProperties',
        {
            type: EngineChannel.SavePropertiesResult,
            correlationId: message.correlationId,
            ok: true,
            applied: status.applied,
            restartRequired: status.restartRequired,
        },
        subsystems,
    );
}

function handleReadWorkflowState(
    message: EngineRequest<'readWorkflowState'>,
    subsystems: DispatchSubsystems,
): void {
    const entries = subsystems.engine.workflowStateStore.listKeys(message.workflowId);
    postCommandResponse(
        'readWorkflowState',
        {
            type: EngineChannel.ReadWorkflowStateResult,
            correlationId: message.correlationId,
            entries,
        },
        subsystems,
    );
}

function handleSetWorkflowStateKey(
    message: EngineRequest<'setWorkflowStateKey'>,
    subsystems: DispatchSubsystems,
): void {
    subsystems.engine.workflowStateStore.setKey(message.workflowId, message.key, message.value);
    postCommandResponse(
        'setWorkflowStateKey',
        {
            type: EngineChannel.SetWorkflowStateKeyResult,
            correlationId: message.correlationId,
            ok: true,
        },
        subsystems,
    );
}

function handleDeleteWorkflowStateKey(
    message: EngineRequest<'deleteWorkflowStateKey'>,
    subsystems: DispatchSubsystems,
): void {
    subsystems.engine.workflowStateStore.deleteKey(message.workflowId, message.key);
    postCommandResponse(
        'deleteWorkflowStateKey',
        {
            type: EngineChannel.DeleteWorkflowStateKeyResult,
            correlationId: message.correlationId,
            ok: true,
        },
        subsystems,
    );
}

export function dispatch(
    message: EngineCommandRequest,
    subsystems: DispatchSubsystems,
): void | Promise<void> {
    return Match.value(message).pipe(
        Match.when({ type: EngineChannel.Ping }, (msg) => handlePing(msg, subsystems)),
        Match.when({ type: EngineChannel.FireTestEvent }, (msg) =>
            handleFireTestEvent(msg, subsystems),
        ),
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
        Match.when({ type: EngineChannel.Shutdown }, (msg) => handleShutdown(msg, subsystems)),
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
