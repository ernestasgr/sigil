import { randomUUID } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { CompiledPipeline } from '@sigil/schema';
import type { Capability } from '@sigil/schema/manifest';
import { app } from 'electron';
import {
    type CommandExecutionOutcome,
    EngineCommandContracts,
    type EngineCommandName,
    type EngineRequestPayload,
    type EngineResponse,
} from '../shared/command-contracts.js';
import type {
    EngineBusEventPayload,
    EngineGetWorkflowResult,
    EnginePong,
    EngineToMainMessage,
    WorkflowActionOutcome,
    WorkflowDeleteOutcome,
    WorkflowStateEntry,
    WorkflowWriteOutcome,
} from '../shared/ipc-channels.js';
import { EngineChannel, EngineToMainMessageOrReadySchema } from '../shared/ipc-channels.js';
import type { PersistenceWriteOutcome } from '../shared/persistence.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import { redactTelemetryText } from '../shared/telemetry-safety.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<EnginePong>;
    readonly fireTestEvent: () => Promise<CommandExecutionOutcome>;
    readonly fireManualTrigger: (pipeline: CompiledPipeline) => Promise<CommandExecutionOutcome>;
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

type ResponseParseResult =
    | { readonly success: true; readonly data: unknown }
    | { readonly success: false; readonly message: string };

type PendingEntry = {
    readonly command: EngineCommandName;
    readonly responseType: string;
    readonly parseResponse: (value: unknown) => ResponseParseResult;
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
    readonly request: <C extends EngineCommandName>(
        command: C,
        payload: EngineRequestPayload<C>,
        timeoutMs?: number,
    ) => Promise<EngineResponse<C>>;
    readonly rejectAll: (reason: string) => void;
    readonly dispatch: (message: EngineToMainMessage) => void;
};

function workerDiagnosticEvent(message: string): EngineBusEventPayload {
    const timestamp = Date.now();
    return {
        name: 'engine.diagnostic',
        payload: {
            message,
            kind: 'engine-worker',
            source: 'worker',
            outcome: 'failed',
        },
        timestamp,
        telemetry: {
            eventId: randomUUID(),
            timestamp,
            kind: 'diagnostic',
            severity: 'error',
            summary: redactTelemetryText(message),
        },
    };
}

function toWorkflowWriteOutcome(
    response: EngineResponse<'createWorkflow'> | EngineResponse<'updateWorkflow'>,
): WorkflowWriteOutcome {
    if ('summary' in response) return { ok: true, summary: response.summary };
    return {
        ok: false,
        error: response.error,
        diagnostics: response.diagnostics,
    };
}

function toWorkflowActionOutcome(
    response: EngineResponse<'toggleWorkflow'> | EngineResponse<'retryWorkflow'>,
): WorkflowActionOutcome {
    if ('error' in response) {
        return {
            ok: false,
            error: response.error,
            diagnostics: response.diagnostics,
        };
    }
    return { ok: true, summary: response.summary };
}

function toWorkflowDeleteOutcome(
    response: EngineResponse<'deleteWorkflow'>,
): WorkflowDeleteOutcome {
    if ('error' in response) {
        return {
            ok: false,
            success: false,
            error: response.error,
            diagnostics: [response.diagnostic],
        };
    }
    return { ok: true, success: response.success };
}

function toExecutionOutcome(
    response: EngineResponse<'fireTestEvent'> | EngineResponse<'fireManualTrigger'>,
): CommandExecutionOutcome {
    return response.ok ? { ok: true } : { ok: false, error: response.error };
}

function responseParseResult(command: EngineCommandName, value: unknown): ResponseParseResult {
    const parsed = EngineCommandContracts[command].responseSchema.safeParse(value);
    if (parsed.success) return { success: true, data: parsed.data };
    return {
        success: false,
        message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
    };
}

export function createRpcClient(props: RpcClientProps): RpcClient {
    const { postMessage, logHandlers, workflowsListHandlers, busEventHandlers } = props;
    const pending = new Map<string, PendingEntry>();

    function request<C extends EngineCommandName>(
        command: C,
        payload: EngineRequestPayload<C>,
        timeoutMs: number = EngineCommandContracts[command].timeoutMs,
    ): Promise<EngineResponse<C>> {
        const correlationId = randomUUID();
        const contract = EngineCommandContracts[command];
        const parsedRequest = contract.requestSchema.safeParse(
            Object.assign({}, payload, {
                correlationId,
                type: contract.command,
            }),
        );
        if (!parsedRequest.success) {
            throw new Error(
                `Invalid ${command} request: ${parsedRequest.error.issues
                    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                    .join('; ')}`,
            );
        }

        return new Promise<EngineResponse<C>>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(correlationId);
                reject(new Error(`${command} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            pending.set(correlationId, {
                command,
                responseType: contract.responseType,
                parseResponse: (value) => responseParseResult(command, value),
                resolve: (value) => resolve(value as EngineResponse<C>),
                reject,
                timer,
            });
            postMessage(parsedRequest.data);
        });
    }

    function rejectAll(reason: string): void {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        pending.clear();
    }

    function resolvePending(message: EngineToMainMessage): void {
        if (!('correlationId' in message)) return;
        const entry = pending.get(message.correlationId);
        if (!entry || message.type !== entry.responseType) return;

        pending.delete(message.correlationId);
        clearTimeout(entry.timer);
        const parsed = entry.parseResponse(message);
        if (!parsed.success) {
            entry.reject(new Error(`Invalid ${entry.command} response: ${parsed.message}`));
            return;
        }
        entry.resolve(parsed.data);
    }

    function dispatch(message: EngineToMainMessage): void {
        switch (message.type) {
            case EngineChannel.Log:
                for (const handler of [...logHandlers]) handler(message.line);
                break;
            case EngineChannel.WorkflowsList:
                for (const handler of [...workflowsListHandlers]) handler(message.workflows);
                break;
            case EngineChannel.BusEvent:
                for (const handler of [...busEventHandlers]) handler(message.event);
                break;
            case EngineChannel.Pong:
            case EngineChannel.FireTestEventResult:
            case EngineChannel.ToggleWorkflowResult:
            case EngineChannel.RetryWorkflowResult:
            case EngineChannel.CreateWorkflowResult:
            case EngineChannel.UpdateWorkflowResult:
            case EngineChannel.DeleteWorkflowResult:
            case EngineChannel.GetWorkflowResult:
            case EngineChannel.ListPluginsResult:
            case EngineChannel.SetPermissionOverrideResult:
            case EngineChannel.ReadPropertiesResult:
            case EngineChannel.SavePropertiesResult:
            case EngineChannel.FireManualTriggerResult:
            case EngineChannel.ReadWorkflowStateResult:
            case EngineChannel.SetWorkflowStateKeyResult:
            case EngineChannel.DeleteWorkflowStateKeyResult:
            case EngineChannel.ShutdownResult:
                resolvePending(message);
                break;
        }
    }

    return { request, rejectAll, dispatch };
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
    let workerFailureReported = false;

    const reportWorkerFailure = (message: string): void => {
        if (workerFailureReported) return;
        workerFailureReported = true;
        const event = workerDiagnosticEvent(message);
        for (const handler of [...busEventHandlers]) handler(event);
    };

    const client = createRpcClient({
        postMessage: (msg: unknown) => {
            worker.postMessage(msg);
        },
        logHandlers,
        workflowsListHandlers,
        busEventHandlers,
    });

    worker.on('message', (raw: unknown) => {
        const parsed = EngineToMainMessageOrReadySchema.safeParse(raw);
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
        reportWorkerFailure(
            `[worker] engine worker error: ${err instanceof Error ? err.message : String(err)}`,
        );
        client.rejectAll('engine worker error');
    });

    worker.on('exit', (code) => {
        if (code !== 0) {
            console.warn(`[engine] worker exited with code ${code}`);
            reportWorkerFailure(`[worker] engine worker exited with code ${code}`);
        }
        client.rejectAll(`engine worker exited with code ${code}`);
    });

    return {
        ping(timeoutMs = EngineCommandContracts.ping.timeoutMs): Promise<EnginePong> {
            return client.request('ping', {}, timeoutMs);
        },
        fireTestEvent(): Promise<CommandExecutionOutcome> {
            return client.request('fireTestEvent', {}).then(toExecutionOutcome);
        },
        fireManualTrigger(pipeline: CompiledPipeline): Promise<CommandExecutionOutcome> {
            return client.request('fireManualTrigger', { pipeline }).then(toExecutionOutcome);
        },
        toggleWorkflow(id: string): Promise<WorkflowActionOutcome> {
            return client.request('toggleWorkflow', { id }).then(toWorkflowActionOutcome);
        },
        retryWorkflow(id: string): Promise<WorkflowActionOutcome> {
            return client.request('retryWorkflow', { id }).then(toWorkflowActionOutcome);
        },
        createWorkflow(
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowWriteOutcome> {
            return client
                .request('createWorkflow', { name, pipeline, positions })
                .then(toWorkflowWriteOutcome);
        },
        updateWorkflow(
            id: string,
            name: string,
            pipeline: CompiledPipeline,
            positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
        ): Promise<WorkflowWriteOutcome> {
            return client
                .request('updateWorkflow', { id, name, pipeline, positions })
                .then(toWorkflowWriteOutcome);
        },
        deleteWorkflow(id: string): Promise<WorkflowDeleteOutcome> {
            return client.request('deleteWorkflow', { id }).then(toWorkflowDeleteOutcome);
        },
        getWorkflow(
            id: string,
            timeoutMs = EngineCommandContracts.getWorkflow.timeoutMs,
        ): Promise<EngineGetWorkflowResult> {
            return client.request('getWorkflow', { id }, timeoutMs);
        },
        listPlugins(
            timeoutMs = EngineCommandContracts.listPlugins.timeoutMs,
        ): Promise<readonly PluginInfo[]> {
            return client
                .request('listPlugins', {}, timeoutMs)
                .then((response) => response.plugins);
        },
        setPermissionOverride(
            pluginId: string,
            overrides: readonly Capability[],
        ): Promise<PersistenceWriteOutcome> {
            return client.request('setPermissionOverride', { pluginId, overrides });
        },
        readProperties(
            timeoutMs = EngineCommandContracts.readProperties.timeoutMs,
        ): Promise<Record<string, unknown>> {
            return client
                .request('readProperties', {}, timeoutMs)
                .then((response) => response.properties);
        },
        saveProperties(properties: Record<string, unknown>): Promise<PersistenceWriteOutcome> {
            return client.request('saveProperties', { properties });
        },
        readWorkflowState(
            workflowId: string,
            timeoutMs = EngineCommandContracts.readWorkflowState.timeoutMs,
        ): Promise<readonly WorkflowStateEntry[]> {
            return client
                .request('readWorkflowState', { workflowId }, timeoutMs)
                .then((response) => response.entries);
        },
        setWorkflowStateKey(workflowId: string, key: string, value: string): Promise<boolean> {
            return client
                .request('setWorkflowStateKey', { workflowId, key, value })
                .then((response) => response.ok);
        },
        deleteWorkflowStateKey(workflowId: string, key: string): Promise<boolean> {
            return client
                .request('deleteWorkflowStateKey', { workflowId, key })
                .then((response) => response.ok);
        },
        terminate(): Promise<number> {
            return client
                .request('shutdown', {})
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
