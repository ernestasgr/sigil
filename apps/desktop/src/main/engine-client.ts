import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { app } from 'electron';

import type { Capability } from '@sigil/schema/manifest';
import type { CompiledPipeline } from '@sigil/schema';

import {
    EngineChannel,
    type EngineBusEventPayload,
    type EngineCreateWorkflow,
    type EngineDeleteWorkflow,
    type EngineFireManualTrigger,
    type EngineFireTestEvent,
    type EngineGetWorkflow,
    type EngineGetWorkflowResult,
    type EngineListPlugins,
    type EngineMessage,
    type EnginePong,
    type EngineReadProperties,
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
} from '../shared/ipc-channels.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<EnginePong>;
    readonly fireTestEvent: () => void;
    readonly fireManualTrigger: (pipeline: CompiledPipeline) => void;
    readonly toggleWorkflow: (id: string) => Promise<WorkflowSummary | null>;
    readonly createWorkflow: (
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
    ) => Promise<WorkflowSummary>;
    readonly updateWorkflow: (
        id: string,
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
    ) => Promise<WorkflowSummary>;
    readonly deleteWorkflow: (id: string) => Promise<boolean>;
    readonly getWorkflow: (id: string, timeoutMs?: number) => Promise<EngineGetWorkflowResult>;
    readonly listPlugins: (timeoutMs?: number) => Promise<readonly PluginInfo[]>;
    readonly setPermissionOverride: (
        pluginId: string,
        overrides: readonly Capability[],
    ) => Promise<boolean>;
    readonly readProperties: (timeoutMs?: number) => Promise<Record<string, unknown>>;
    readonly saveProperties: (properties: Record<string, unknown>) => Promise<boolean>;
    readonly terminate: () => Promise<number>;
    readonly onReady: (handler: () => void) => void;
    readonly onLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
    readonly onBusEvent: (handler: (event: EngineBusEventPayload) => void) => () => void;
};

export function spawnEngine(): EngineHandle {
    const workerPath = resolvePath(__dirname, 'worker.js');
    const userDataPath = app.getPath('userData');
    const worker = new Worker(workerPath, { workerData: { userDataPath } });

    const pendingPings = new Map<
        string,
        { resolve: (pong: EnginePong) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
    >();
    const pendingGetWorkflows = new Map<
        string,
        {
            resolve: (result: EngineGetWorkflowResult) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingCreateWorkflows = new Map<
        string,
        {
            resolve: (value: WorkflowSummary) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingUpdateWorkflows = new Map<
        string,
        {
            resolve: (value: WorkflowSummary) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingDeleteWorkflows = new Map<
        string,
        {
            resolve: (value: boolean) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingToggles = new Map<
        string,
        {
            resolve: (value: WorkflowSummary | null) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingListPlugins = new Map<
        string,
        {
            resolve: (value: readonly PluginInfo[]) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingSetPermissionOverrides = new Map<
        string,
        {
            resolve: (value: boolean) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingReadProperties = new Map<
        string,
        {
            resolve: (value: Record<string, unknown>) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const pendingSaveProperties = new Map<
        string,
        {
            resolve: (value: boolean) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    const readyHandlers = new Set<() => void>();
    const logHandlers = new Set<(line: string) => void>();
    const workflowsListHandlers = new Set<(workflows: readonly WorkflowSummary[]) => void>();
    const busEventHandlers = new Set<(event: EngineBusEventPayload) => void>();
    let ready = false;

    function rejectAllPending(reason: string) {
        for (const [, entry] of pendingPings) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingPings.clear();
        for (const [, entry] of pendingGetWorkflows) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingGetWorkflows.clear();
        for (const [, entry] of pendingCreateWorkflows) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingCreateWorkflows.clear();
        for (const [, entry] of pendingUpdateWorkflows) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingUpdateWorkflows.clear();
        for (const [, entry] of pendingDeleteWorkflows) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingDeleteWorkflows.clear();
        for (const [, entry] of pendingToggles) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingToggles.clear();
        for (const [, entry] of pendingListPlugins) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingListPlugins.clear();
        for (const [, entry] of pendingSetPermissionOverrides) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingSetPermissionOverrides.clear();
        for (const [, entry] of pendingReadProperties) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingReadProperties.clear();
        for (const [, entry] of pendingSaveProperties) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pendingSaveProperties.clear();
    }

    worker.on('message', (message: EngineMessage | { type: 'engine:ready' }) => {
        if (message.type === 'engine:ready') {
            ready = true;
            for (const handler of readyHandlers) handler();
            return;
        }
        if (message.type === EngineChannel.Pong) {
            const entry = pendingPings.get(message.id);
            if (entry) {
                pendingPings.delete(message.id);
                clearTimeout(entry.timer);
                entry.resolve(message);
            }
            return;
        }
        if (message.type === EngineChannel.Log) {
            for (const handler of [...logHandlers]) handler(message.line);
            return;
        }
        if (message.type === EngineChannel.WorkflowsList) {
            for (const handler of [...workflowsListHandlers]) handler(message.workflows);
            return;
        }
        if (message.type === EngineChannel.GetWorkflowResult) {
            const entry = pendingGetWorkflows.get(message.correlationId);
            if (entry) {
                pendingGetWorkflows.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message);
            }
            return;
        }
        if (message.type === EngineChannel.CreateWorkflowResult) {
            const entry = pendingCreateWorkflows.get(message.correlationId);
            if (entry) {
                pendingCreateWorkflows.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.summary);
            }
            return;
        }
        if (message.type === EngineChannel.UpdateWorkflowResult) {
            const entry = pendingUpdateWorkflows.get(message.correlationId);
            if (entry) {
                pendingUpdateWorkflows.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.summary);
            }
            return;
        }
        if (message.type === EngineChannel.DeleteWorkflowResult) {
            const entry = pendingDeleteWorkflows.get(message.correlationId);
            if (entry) {
                pendingDeleteWorkflows.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.success);
            }
            return;
        }
        if (message.type === EngineChannel.ToggleWorkflowResult) {
            const entry = pendingToggles.get(message.correlationId);
            if (entry) {
                pendingToggles.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.summary);
            }
            return;
        }
        if (message.type === EngineChannel.BusEvent) {
            for (const handler of [...busEventHandlers]) handler(message.event);
            return;
        }
        if (message.type === EngineChannel.ListPluginsResult) {
            const entry = pendingListPlugins.get(message.correlationId);
            if (entry) {
                pendingListPlugins.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.plugins);
            }
            return;
        }
        if (message.type === EngineChannel.SetPermissionOverrideResult) {
            const entry = pendingSetPermissionOverrides.get(message.correlationId);
            if (entry) {
                pendingSetPermissionOverrides.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.ok);
            }
            return;
        }
        if (message.type === EngineChannel.ReadPropertiesResult) {
            const entry = pendingReadProperties.get(message.correlationId);
            if (entry) {
                pendingReadProperties.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.properties);
            }
            return;
        }
        if (message.type === EngineChannel.SavePropertiesResult) {
            const entry = pendingSaveProperties.get(message.correlationId);
            if (entry) {
                pendingSaveProperties.delete(message.correlationId);
                clearTimeout(entry.timer);
                entry.resolve(message.ok);
            }
            return;
        }
    });

    worker.on('error', (err) => {
        console.error('[engine] worker error:', err);
        rejectAllPending('engine worker error');
    });

    worker.on('exit', (code) => {
        if (code !== 0) {
            console.warn(`[engine] worker exited with code ${code}`);
        }
        rejectAllPending(`engine worker exited with code ${code}`);
    });

    return {
        ping(timeoutMs = 5000): Promise<EnginePong> {
            const id = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingPings.delete(id);
                    reject(new Error(`engine ping timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                pendingPings.set(id, { resolve, reject, timer });

                const ping: EngineMessage = { id, type: EngineChannel.Ping };
                worker.postMessage(ping);
            });
        },
        fireTestEvent(): void {
            const fire: EngineFireTestEvent = { type: EngineChannel.FireTestEvent };
            worker.postMessage(fire);
        },
        fireManualTrigger(pipeline: CompiledPipeline): void {
            const msg: EngineFireManualTrigger = {
                type: EngineChannel.FireManualTrigger,
                pipeline,
            };
            worker.postMessage(msg);
        },
        toggleWorkflow(id: string): Promise<WorkflowSummary | null> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingToggles.delete(correlationId);
                    reject(new Error(`toggleWorkflow timed out after 5000ms`));
                }, 5000);
                pendingToggles.set(correlationId, { resolve, reject, timer });
                const msg: EngineToggleWorkflow = {
                    type: EngineChannel.ToggleWorkflow,
                    correlationId,
                    id,
                };
                worker.postMessage(msg);
            });
        },
        createWorkflow(
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowSummary> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingCreateWorkflows.delete(correlationId);
                    reject(new Error(`createWorkflow timed out after 5000ms`));
                }, 5000);
                pendingCreateWorkflows.set(correlationId, { resolve, reject, timer });
                const msg: EngineCreateWorkflow = {
                    type: EngineChannel.CreateWorkflow,
                    correlationId,
                    name,
                    pipeline,
                    positions,
                };
                worker.postMessage(msg);
            });
        },
        updateWorkflow(
            id: string,
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowSummary> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingUpdateWorkflows.delete(correlationId);
                    reject(new Error(`updateWorkflow timed out after 5000ms`));
                }, 5000);
                pendingUpdateWorkflows.set(correlationId, { resolve, reject, timer });
                const msg: EngineUpdateWorkflow = {
                    type: EngineChannel.UpdateWorkflow,
                    correlationId,
                    id,
                    name,
                    pipeline,
                    positions,
                };
                worker.postMessage(msg);
            });
        },
        deleteWorkflow(id: string): Promise<boolean> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingDeleteWorkflows.delete(correlationId);
                    reject(new Error(`deleteWorkflow timed out after 5000ms`));
                }, 5000);
                pendingDeleteWorkflows.set(correlationId, { resolve, reject, timer });
                const msg: EngineDeleteWorkflow = {
                    type: EngineChannel.DeleteWorkflow,
                    correlationId,
                    id,
                };
                worker.postMessage(msg);
            });
        },
        getWorkflow(id: string, timeoutMs = 5000): Promise<EngineGetWorkflowResult> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingGetWorkflows.delete(correlationId);
                    reject(new Error(`getWorkflow timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                pendingGetWorkflows.set(correlationId, { resolve, reject, timer });

                const msg: EngineGetWorkflow = {
                    type: EngineChannel.GetWorkflow,
                    id,
                    correlationId,
                };
                worker.postMessage(msg);
            });
        },
        listPlugins(timeoutMs = 5000): Promise<readonly PluginInfo[]> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingListPlugins.delete(correlationId);
                    reject(new Error(`listPlugins timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                pendingListPlugins.set(correlationId, { resolve, reject, timer });

                const msg: EngineListPlugins = {
                    type: EngineChannel.ListPlugins,
                    correlationId,
                };
                worker.postMessage(msg);
            });
        },
        setPermissionOverride(
            pluginId: string,
            overrides: readonly Capability[],
        ): Promise<boolean> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingSetPermissionOverrides.delete(correlationId);
                    reject(new Error(`setPermissionOverride timed out after 5000ms`));
                }, 5000);

                pendingSetPermissionOverrides.set(correlationId, { resolve, reject, timer });

                const msg: EngineSetPermissionOverride = {
                    type: EngineChannel.SetPermissionOverride,
                    correlationId,
                    pluginId,
                    overrides,
                };
                worker.postMessage(msg);
            });
        },
        readProperties(timeoutMs = 5000): Promise<Record<string, unknown>> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingReadProperties.delete(correlationId);
                    reject(new Error(`readProperties timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                pendingReadProperties.set(correlationId, { resolve, reject, timer });

                const msg: EngineReadProperties = {
                    type: EngineChannel.ReadProperties,
                    correlationId,
                };
                worker.postMessage(msg);
            });
        },
        saveProperties(properties: Record<string, unknown>): Promise<boolean> {
            const correlationId = randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingSaveProperties.delete(correlationId);
                    reject(new Error(`saveProperties timed out after 5000ms`));
                }, 5000);

                pendingSaveProperties.set(correlationId, { resolve, reject, timer });

                const msg: EngineSaveProperties = {
                    type: EngineChannel.SaveProperties,
                    correlationId,
                    properties,
                };
                worker.postMessage(msg);
            });
        },
        terminate(): Promise<number> {
            return worker.terminate();
        },
        onReady(handler: () => void): void {
            if (ready) {
                handler();
            } else {
                readyHandlers.add(handler);
            }
        },
        onLog(handler: (line: string) => void): () => void {
            logHandlers.add(handler);
            return () => {
                logHandlers.delete(handler);
            };
        },
        onWorkflowsList(handler: (workflows: readonly WorkflowSummary[]) => void): () => void {
            workflowsListHandlers.add(handler);
            return () => {
                workflowsListHandlers.delete(handler);
            };
        },
        onBusEvent(handler: (event: EngineBusEventPayload) => void): () => void {
            busEventHandlers.add(handler);
            return () => {
                busEventHandlers.delete(handler);
            };
        },
    };
}
