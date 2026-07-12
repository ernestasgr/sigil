import { randomUUID } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { CompiledPipeline } from '@sigil/schema';
import type { Capability } from '@sigil/schema/manifest';
import { app } from 'electron';
import { z } from 'zod';
import type { WorkflowStateEntry } from '../shared/ipc-channels.js';
import {
    type EngineBusEventPayload,
    EngineChannel,
    type EngineGetWorkflowResult,
    type EngineMessage,
    EngineMessageSchema,
    type EnginePong,
    EngineReadySchema,
    type PersistenceDiagnostic,
    type WorkflowActionOutcome,
    type WorkflowDeleteOutcome,
    type WorkflowWriteDiagnostic,
    type WorkflowWriteOutcome,
} from '../shared/ipc-channels.js';
import type { PersistenceWriteOutcome } from '../shared/persistence.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<EnginePong>;
    readonly fireTestEvent: () => void;
    readonly fireManualTrigger: (pipeline: CompiledPipeline) => void;
    readonly toggleWorkflow: (id: string) => Promise<WorkflowActionOutcome>;
    readonly retryWorkflow: (id: string) => Promise<WorkflowActionOutcome>;
    readonly createWorkflow: (
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
    ) => Promise<WorkflowWriteOutcome>;
    readonly updateWorkflow: (
        id: string,
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
    ) => Promise<WorkflowWriteOutcome>;
    readonly deleteWorkflow: (id: string) => Promise<WorkflowDeleteOutcome>;
    readonly getWorkflow: (id: string, timeoutMs?: number) => Promise<EngineGetWorkflowResult>;
    readonly listPlugins: (timeoutMs?: number) => Promise<readonly PluginInfo[]>;
    readonly setPermissionOverride: (
        pluginId: string,
        overrides: readonly Capability[],
    ) => Promise<PersistenceWriteOutcome>;
    readonly readProperties: (timeoutMs?: number) => Promise<Record<string, unknown>>;
    readonly saveProperties: (
        properties: Record<string, unknown>,
    ) => Promise<PersistenceWriteOutcome>;
    readonly readWorkflowState: (
        workflowId: string,
        timeoutMs?: number,
    ) => Promise<readonly WorkflowStateEntry[]>;
    readonly setWorkflowStateKey: (
        workflowId: string,
        key: string,
        value: string,
    ) => Promise<boolean>;
    readonly deleteWorkflowStateKey: (workflowId: string, key: string) => Promise<boolean>;
    readonly terminate: () => Promise<number>;
    readonly onReady: (handler: () => void) => void;
    readonly onLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
    readonly onBusEvent: (handler: (event: EngineBusEventPayload) => void) => () => void;
};

type PendingEntry = {
    readonly resolve: (value: unknown) => void;
    readonly reject: (err: Error) => void;
    readonly timer: NodeJS.Timeout;
};

export type RpcClientProps = {
    readonly postMessage: (msg: unknown) => void;
    readonly logHandlers: Set<(line: string) => void>;
    readonly workflowsListHandlers: Set<(workflows: readonly WorkflowSummary[]) => void>;
    readonly busEventHandlers: Set<(event: EngineBusEventPayload) => void>;
};

export type RpcClient = {
    readonly rpc: <Res>(
        channel: string,
        payload: Record<string, unknown>,
        timeoutMs: number,
        idField?: 'correlationId' | 'id',
    ) => Promise<Res>;
    readonly rejectAll: (reason: string) => void;
    readonly dispatch: (message: EngineMessage) => void;
};

type WorkflowWriteResponse = {
    readonly summary?: WorkflowSummary;
    readonly error?: string;
    readonly diagnostics?: readonly WorkflowWriteDiagnostic[];
};

type WorkflowActionResponse = {
    readonly summary: WorkflowSummary | null;
    readonly error?: string;
    readonly diagnostics?: readonly PersistenceDiagnostic[];
};

type WorkflowDeleteResponse = {
    readonly success: boolean;
    readonly error?: string;
    readonly diagnostic?: PersistenceDiagnostic;
};

function toWorkflowWriteOutcome(response: WorkflowWriteResponse): WorkflowWriteOutcome {
    if (response.summary) return { ok: true, summary: response.summary };
    return {
        ok: false,
        error: response.error ?? 'Engine returned no workflow summary.',
        diagnostics: response.diagnostics ?? [],
    };
}

function toWorkflowActionOutcome(response: WorkflowActionResponse): WorkflowActionOutcome {
    if (response.error) {
        return {
            ok: false,
            error: response.error,
            diagnostics: response.diagnostics ?? [],
        };
    }
    return { ok: true, summary: response.summary };
}

function toWorkflowDeleteOutcome(response: WorkflowDeleteResponse): WorkflowDeleteOutcome {
    if (response.error) {
        return {
            ok: false,
            success: false,
            error: response.error,
            diagnostics: response.diagnostic ? [response.diagnostic] : [],
        };
    }
    return { ok: true, success: response.success };
}

export function createRpcClient(props: RpcClientProps): RpcClient {
    const { postMessage, logHandlers, workflowsListHandlers, busEventHandlers } = props;
    const pending = new Map<string, PendingEntry>();

    function rpc<Res>(
        channel: string,
        payload: Record<string, unknown>,
        timeoutMs: number,
        idField: 'correlationId' | 'id' = 'correlationId',
    ): Promise<Res> {
        const id = randomUUID();
        return new Promise<Res>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${channel} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
            postMessage({ ...payload, [idField]: id, type: channel });
        });
    }

    function rejectAll(reason: string) {
        for (const [, entry] of pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pending.clear();
    }

    function resolvePending(correlationId: string, message: EngineMessage): void {
        const entry = pending.get(correlationId);
        if (entry) {
            pending.delete(correlationId);
            clearTimeout(entry.timer);
            entry.resolve(message);
        }
    }

    function dispatch(message: EngineMessage): void {
        switch (message.type) {
            case EngineChannel.Pong: {
                const entry = pending.get(message.id);
                if (entry) {
                    pending.delete(message.id);
                    clearTimeout(entry.timer);
                    entry.resolve(message);
                }
                break;
            }
            case EngineChannel.Log:
                for (const handler of [...logHandlers]) handler(message.line);
                break;
            case EngineChannel.WorkflowsList:
                for (const handler of [...workflowsListHandlers]) handler(message.workflows);
                break;
            case EngineChannel.BusEvent:
                for (const handler of [...busEventHandlers]) handler(message.event);
                break;
            case EngineChannel.GetWorkflowResult:
            case EngineChannel.CreateWorkflowResult:
            case EngineChannel.UpdateWorkflowResult:
            case EngineChannel.DeleteWorkflowResult:
            case EngineChannel.ToggleWorkflowResult:
            case EngineChannel.RetryWorkflowResult:
            case EngineChannel.ListPluginsResult:
            case EngineChannel.SetPermissionOverrideResult:
            case EngineChannel.ReadPropertiesResult:
            case EngineChannel.SavePropertiesResult:
            case EngineChannel.ReadWorkflowStateResult:
            case EngineChannel.SetWorkflowStateKeyResult:
            case EngineChannel.DeleteWorkflowStateKeyResult:
            case EngineChannel.ShutdownResult:
                resolvePending(message.correlationId, message);
                break;
            case EngineChannel.Ping:
            case EngineChannel.FireTestEvent:
            case EngineChannel.FireManualTrigger:
            case EngineChannel.ToggleWorkflow:
            case EngineChannel.RetryWorkflow:
            case EngineChannel.CreateWorkflow:
            case EngineChannel.UpdateWorkflow:
            case EngineChannel.DeleteWorkflow:
            case EngineChannel.GetWorkflow:
            case EngineChannel.ListPlugins:
            case EngineChannel.SetPermissionOverride:
            case EngineChannel.ReadProperties:
            case EngineChannel.SaveProperties:
            case EngineChannel.ReadWorkflowState:
            case EngineChannel.SetWorkflowStateKey:
            case EngineChannel.DeleteWorkflowStateKey:
            case EngineChannel.Shutdown:
                console.warn(`[engine] unexpected message from worker: ${message.type}`);
                break;
        }
    }

    return { rpc, rejectAll, dispatch };
}

export function spawnEngine(): EngineHandle {
    const workerPath = resolvePath(__dirname, 'worker.js');
    const userDataPath = app.getPath('userData');
    const worker = new Worker(workerPath, { workerData: { userDataPath } });

    const logHandlers = new Set<(line: string) => void>();
    const workflowsListHandlers = new Set<(workflows: readonly WorkflowSummary[]) => void>();
    const busEventHandlers = new Set<(event: EngineBusEventPayload) => void>();
    const readyHandlers = new Set<() => void>();
    let ready = false;

    const client = createRpcClient({
        postMessage: (msg: unknown) => {
            worker.postMessage(msg);
        },
        logHandlers,
        workflowsListHandlers,
        busEventHandlers,
    });

    const engineMessageOrReadySchema = z.union([EngineMessageSchema, EngineReadySchema]);

    worker.on('message', (raw: unknown) => {
        const parsed = engineMessageOrReadySchema.safeParse(raw);
        if (!parsed.success) {
            console.error(
                '[engine] invalid message envelope:',
                parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            );
            return;
        }
        const message = parsed.data;
        if (message.type === 'engine:ready') {
            ready = true;
            for (const handler of readyHandlers) handler();
            return;
        }
        client.dispatch(message);
    });

    worker.on('error', (err) => {
        console.error('[engine] worker error:', err);
        client.rejectAll('engine worker error');
    });

    worker.on('exit', (code) => {
        if (code !== 0) {
            console.warn(`[engine] worker exited with code ${code}`);
        }
        client.rejectAll(`engine worker exited with code ${code}`);
    });

    return {
        ping(timeoutMs = 5000): Promise<EnginePong> {
            return client.rpc<EnginePong>(EngineChannel.Ping, {}, timeoutMs, 'id');
        },
        fireTestEvent(): void {
            worker.postMessage({ type: EngineChannel.FireTestEvent });
        },
        fireManualTrigger(pipeline: CompiledPipeline): void {
            worker.postMessage({ type: EngineChannel.FireManualTrigger, pipeline });
        },
        toggleWorkflow(id: string): Promise<WorkflowActionOutcome> {
            return client
                .rpc<WorkflowActionResponse>(EngineChannel.ToggleWorkflow, { id }, 5000)
                .then(toWorkflowActionOutcome);
        },
        retryWorkflow(id: string): Promise<WorkflowActionOutcome> {
            return client
                .rpc<WorkflowActionResponse>(EngineChannel.RetryWorkflow, { id }, 5000)
                .then(toWorkflowActionOutcome);
        },
        createWorkflow(
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowWriteOutcome> {
            return client
                .rpc<WorkflowWriteResponse>(
                    EngineChannel.CreateWorkflow,
                    { name, pipeline, positions },
                    5000,
                )
                .then(toWorkflowWriteOutcome);
        },
        updateWorkflow(
            id: string,
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowWriteOutcome> {
            return client
                .rpc<WorkflowWriteResponse>(
                    EngineChannel.UpdateWorkflow,
                    { id, name, pipeline, positions },
                    5000,
                )
                .then(toWorkflowWriteOutcome);
        },
        deleteWorkflow(id: string): Promise<WorkflowDeleteOutcome> {
            return client
                .rpc<WorkflowDeleteResponse>(EngineChannel.DeleteWorkflow, { id }, 5000)
                .then(toWorkflowDeleteOutcome);
        },
        getWorkflow(id: string, timeoutMs = 5000): Promise<EngineGetWorkflowResult> {
            return client.rpc<EngineGetWorkflowResult>(
                EngineChannel.GetWorkflow,
                { id },
                timeoutMs,
            );
        },
        listPlugins(timeoutMs = 5000): Promise<readonly PluginInfo[]> {
            return client
                .rpc<{ plugins: readonly PluginInfo[] }>(EngineChannel.ListPlugins, {}, timeoutMs)
                .then((r) => r.plugins);
        },
        setPermissionOverride(
            pluginId: string,
            overrides: readonly Capability[],
        ): Promise<PersistenceWriteOutcome> {
            return client
                .rpc<{
                    ok: boolean;
                    error?: string;
                    diagnostic?: PersistenceDiagnostic;
                }>(EngineChannel.SetPermissionOverride, { pluginId, overrides }, 5000)
                .then(({ ok, error, diagnostic }) =>
                    ok
                        ? { ok: true }
                        : {
                              ok: false,
                              error: error ?? 'Permission override persistence failed.',
                              diagnostic: diagnostic ?? {
                                  kind: 'persistence',
                                  operation: 'write',
                                  phase: 'write',
                                  path: 'permission-overrides.json',
                                  message: 'Permission override persistence failed.',
                              },
                          },
                );
        },
        readProperties(timeoutMs = 5000): Promise<Record<string, unknown>> {
            return client
                .rpc<{
                    properties: Record<string, unknown>;
                }>(EngineChannel.ReadProperties, {}, timeoutMs)
                .then((r) => r.properties);
        },
        saveProperties(properties: Record<string, unknown>): Promise<PersistenceWriteOutcome> {
            return client
                .rpc<{
                    ok: boolean;
                    error?: string;
                    diagnostic?: PersistenceDiagnostic;
                }>(EngineChannel.SaveProperties, { properties }, 5000)
                .then(({ ok, error, diagnostic }) =>
                    ok
                        ? { ok: true }
                        : {
                              ok: false,
                              error: error ?? 'Properties persistence failed.',
                              diagnostic: diagnostic ?? {
                                  kind: 'persistence',
                                  operation: 'write',
                                  phase: 'write',
                                  path: 'sigil.properties.json',
                                  message: 'Properties persistence failed.',
                              },
                          },
                );
        },
        readWorkflowState(
            workflowId: string,
            timeoutMs = 5000,
        ): Promise<readonly WorkflowStateEntry[]> {
            return client
                .rpc<{
                    entries: readonly WorkflowStateEntry[];
                }>(EngineChannel.ReadWorkflowState, { workflowId }, timeoutMs)
                .then((r) => r.entries);
        },
        setWorkflowStateKey(workflowId: string, key: string, value: string): Promise<boolean> {
            return client
                .rpc<{
                    ok: boolean;
                }>(EngineChannel.SetWorkflowStateKey, { workflowId, key, value }, 5000)
                .then((r) => r.ok);
        },
        deleteWorkflowStateKey(workflowId: string, key: string): Promise<boolean> {
            return client
                .rpc<{
                    ok: boolean;
                }>(EngineChannel.DeleteWorkflowStateKey, { workflowId, key }, 5000)
                .then((r) => r.ok);
        },
        terminate(): Promise<number> {
            return client
                .rpc<{ readonly ok: boolean }>(EngineChannel.Shutdown, {}, 30_000)
                .catch(() => undefined)
                .then(() => worker.terminate());
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
