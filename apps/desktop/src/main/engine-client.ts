import { randomUUID } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { z } from 'zod';
import {
    CorrelationIdSchema,
    EngineCommandContracts,
    type EngineCommandName,
    type EngineCommandResponse,
    type EngineRequestPayload,
    type EngineResponse,
    EngineToMainMessageOrReadySchema,
    EngineToMainMessageSchema,
} from '../shared/command-contracts.js';
import {
    createEngineDiagnostic,
    EventPayloadSchemaRegistry,
    safeParsePayload,
} from '../shared/event-payload-schemas.js';
import type { EngineBusEventPayload, EngineToMainMessage } from '../shared/ipc-channels.js';
import { EngineChannel } from '../shared/ipc-channels.js';
import { redactTelemetryText } from '../shared/telemetry-safety.js';
import type {
    CommandExecutionOutcome,
    GetWorkflowOutput,
    ListPluginsOutput,
    PermissionOverrideOutcome,
    PingEngineOutput,
    PropertiesReadOutput,
    PropertiesSaveOutcome,
    ReadWorkflowStateOutput,
    WorkflowActionOutcome,
    WorkflowDeleteOutcome,
    WorkflowWriteOutcome,
} from '../shared/trpc-contracts.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<PingEngineOutput>;
    readonly fireTestEvent: () => Promise<CommandExecutionOutcome>;
    readonly fireManualTrigger: (
        payload: EngineRequestPayload<'fireManualTrigger'>,
    ) => Promise<CommandExecutionOutcome>;
    readonly toggleWorkflow: (
        payload: EngineRequestPayload<'toggleWorkflow'>,
    ) => Promise<WorkflowActionOutcome>;
    readonly retryWorkflow: (
        payload: EngineRequestPayload<'retryWorkflow'>,
    ) => Promise<WorkflowActionOutcome>;
    readonly createWorkflow: (
        payload: EngineRequestPayload<'createWorkflow'>,
    ) => Promise<WorkflowWriteOutcome>;
    readonly updateWorkflow: (
        payload: EngineRequestPayload<'updateWorkflow'>,
    ) => Promise<WorkflowWriteOutcome>;
    readonly deleteWorkflow: (
        payload: EngineRequestPayload<'deleteWorkflow'>,
    ) => Promise<WorkflowDeleteOutcome>;
    readonly getWorkflow: (
        id: EngineRequestPayload<'getWorkflow'>['id'],
        timeoutMs?: number,
    ) => Promise<GetWorkflowOutput>;
    readonly listPlugins: (timeoutMs?: number) => Promise<ListPluginsOutput>;
    readonly setPermissionOverride: (
        payload: EngineRequestPayload<'setPermissionOverride'>,
    ) => Promise<PermissionOverrideOutcome>;
    readonly readProperties: (timeoutMs?: number) => Promise<PropertiesReadOutput>;
    readonly saveProperties: (
        payload: EngineRequestPayload<'saveProperties'>,
    ) => Promise<PropertiesSaveOutcome>;
    readonly readWorkflowState: (
        workflowId: EngineRequestPayload<'readWorkflowState'>['workflowId'],
        timeoutMs?: number,
    ) => Promise<ReadWorkflowStateOutput>;
    readonly setWorkflowStateKey: (
        payload: EngineRequestPayload<'setWorkflowStateKey'>,
    ) => Promise<boolean>;
    readonly deleteWorkflowStateKey: (
        payload: EngineRequestPayload<'deleteWorkflowStateKey'>,
    ) => Promise<boolean>;
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
    readonly dispatch: (message: unknown) => void;
};

const engineResponseTypes: ReadonlySet<string> = new Set(
    Object.values(EngineCommandContracts).map((contract) => contract.responseType),
);

const EngineResponseEnvelopeSchema = z.object({
    type: z.string(),
    correlationId: CorrelationIdSchema,
});

function isEngineCommandResponse(message: EngineToMainMessage): message is EngineCommandResponse {
    return engineResponseTypes.has(message.type);
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Engine message: ${JSON.stringify(value)}`);
}

void ({
    ping: true,
    fireTestEvent: true,
    toggleWorkflow: true,
    retryWorkflow: true,
    createWorkflow: true,
    updateWorkflow: true,
    deleteWorkflow: true,
    getWorkflow: true,
    listPlugins: true,
    setPermissionOverride: true,
    readProperties: true,
    saveProperties: true,
    fireManualTrigger: true,
    readWorkflowState: true,
    setWorkflowStateKey: true,
    deleteWorkflowStateKey: true,
    shutdown: true,
} satisfies Record<EngineCommandName, true>);

export function workerDiagnosticEvent(message: string): EngineBusEventPayload {
    const timestamp = Date.now();
    return {
        ...createEngineDiagnostic({
            message,
            kind: 'engine-worker',
            source: 'worker',
            outcome: 'failed',
        }),
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

function toWorkflowGetOutcome(response: EngineResponse<'getWorkflow'>): GetWorkflowOutput {
    if (!response.found) return null;
    return {
        name: response.name,
        document: response.document,
        positions: response.positions,
    };
}

export function toPermissionOverrideOutcome(
    response: EngineResponse<'setPermissionOverride'>,
): PermissionOverrideOutcome {
    if (response.ok) {
        return {
            ok: true,
            grantedPermissions: response.grantedPermissions,
            cancelledRunIds: response.cancelledRunIds,
        };
    }
    if (response.kind === 'domain') {
        return {
            ok: false,
            kind: 'domain',
            code: response.code,
            pluginId: response.pluginId,
            error: response.error,
        };
    }
    return {
        ok: false,
        kind: 'persistence',
        error: response.error,
        diagnostic: response.diagnostic,
    };
}

function toPropertiesSaveOutcome(
    response: EngineResponse<'saveProperties'>,
): PropertiesSaveOutcome {
    if (response.ok) {
        return {
            ok: true,
            applied: response.applied,
            restartRequired: response.restartRequired,
        };
    }
    if (response.kind === 'validation') {
        return {
            ok: false,
            kind: 'validation',
            error: response.error,
            issues: response.issues,
        };
    }
    return {
        ok: false,
        kind: 'write',
        error: response.error,
        diagnostic: response.diagnostic,
    };
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

    function takePending(correlationId: string): PendingEntry | undefined {
        const entry = pending.get(correlationId);
        if (!entry) return undefined;
        pending.delete(correlationId);
        clearTimeout(entry.timer);
        return entry;
    }

    function settlePending(correlationId: string, settle: (entry: PendingEntry) => void): void {
        const entry = takePending(correlationId);
        if (entry) settle(entry);
    }

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
                settlePending(correlationId, (entry) => {
                    entry.reject(new Error(`${command} timed out after ${timeoutMs}ms`));
                });
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
        for (const correlationId of [...pending.keys()]) {
            settlePending(correlationId, (entry) => {
                entry.reject(new Error(reason));
            });
        }
    }

    function resolvePending(message: EngineToMainMessage): void {
        if (!('correlationId' in message)) return;
        const entry = pending.get(message.correlationId);
        if (!entry || message.type !== entry.responseType) return;

        const parsed = entry.parseResponse(message);
        settlePending(message.correlationId, (settledEntry) => {
            if (!parsed.success) {
                settledEntry.reject(
                    new Error(`Invalid ${settledEntry.command} response: ${parsed.message}`),
                );
                return;
            }
            settledEntry.resolve(parsed.data);
        });
    }

    function rejectMalformedResponse(raw: unknown, detail: string): void {
        const envelope = EngineResponseEnvelopeSchema.safeParse(raw);
        if (!envelope.success) return;

        const entry = pending.get(envelope.data.correlationId);
        if (!entry || envelope.data.type !== entry.responseType) return;

        settlePending(envelope.data.correlationId, (settledEntry) => {
            settledEntry.reject(new Error(`Invalid ${settledEntry.command} response: ${detail}`));
        });
    }

    function dispatch(raw: unknown): void {
        const parsed = EngineToMainMessageSchema.safeParse(raw);
        if (!parsed.success) {
            const detail = parsed.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; ');
            console.error(`[engine] invalid message envelope: ${detail}`);
            rejectMalformedResponse(raw, detail);
            return;
        }
        const message = parsed.data;
        switch (message.type) {
            case EngineChannel.Log:
                for (const handler of [...logHandlers]) handler(message.line);
                break;
            case EngineChannel.WorkflowsList:
                for (const handler of [...workflowsListHandlers]) handler(message.workflows);
                break;
            case EngineChannel.BusEvent:
                if (Object.hasOwn(EventPayloadSchemaRegistry, message.event.name)) {
                    const parsedPayload = safeParsePayload(
                        message.event.name,
                        message.event.payload,
                    );
                    if (parsedPayload._tag === 'Left') {
                        console.error(`[engine] invalid bus-event payload: ${parsedPayload.left}`);
                        return;
                    }
                    const event = { ...message.event, payload: parsedPayload.right };
                    for (const handler of [...busEventHandlers]) handler(event);
                    break;
                }
                for (const handler of [...busEventHandlers]) handler(message.event);
                break;
            default:
                if (isEngineCommandResponse(message)) {
                    resolvePending(message);
                    return;
                }
                assertNever(message);
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
        if (parsed.success && parsed.data.type === 'engine:ready') {
            ready = true;
            for (const handler of readyHandlers) handler();
            return;
        }
        client.dispatch(raw);
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
        ping(timeoutMs = EngineCommandContracts.ping.timeoutMs): Promise<PingEngineOutput> {
            return client.request('ping', {}, timeoutMs);
        },
        fireTestEvent(): Promise<CommandExecutionOutcome> {
            return client.request('fireTestEvent', {}).then(toExecutionOutcome);
        },
        fireManualTrigger(
            payload: EngineRequestPayload<'fireManualTrigger'>,
        ): Promise<CommandExecutionOutcome> {
            return client.request('fireManualTrigger', payload).then(toExecutionOutcome);
        },
        toggleWorkflow(
            payload: EngineRequestPayload<'toggleWorkflow'>,
        ): Promise<WorkflowActionOutcome> {
            return client.request('toggleWorkflow', payload).then(toWorkflowActionOutcome);
        },
        retryWorkflow(
            payload: EngineRequestPayload<'retryWorkflow'>,
        ): Promise<WorkflowActionOutcome> {
            return client.request('retryWorkflow', payload).then(toWorkflowActionOutcome);
        },
        createWorkflow(
            payload: EngineRequestPayload<'createWorkflow'>,
        ): Promise<WorkflowWriteOutcome> {
            return client.request('createWorkflow', payload).then(toWorkflowWriteOutcome);
        },
        updateWorkflow(
            payload: EngineRequestPayload<'updateWorkflow'>,
        ): Promise<WorkflowWriteOutcome> {
            return client.request('updateWorkflow', payload).then(toWorkflowWriteOutcome);
        },
        deleteWorkflow(
            payload: EngineRequestPayload<'deleteWorkflow'>,
        ): Promise<WorkflowDeleteOutcome> {
            return client.request('deleteWorkflow', payload).then(toWorkflowDeleteOutcome);
        },
        getWorkflow(
            id: EngineRequestPayload<'getWorkflow'>['id'],
            timeoutMs = EngineCommandContracts.getWorkflow.timeoutMs,
        ): Promise<GetWorkflowOutput> {
            return client.request('getWorkflow', { id }, timeoutMs).then(toWorkflowGetOutcome);
        },
        listPlugins(
            timeoutMs = EngineCommandContracts.listPlugins.timeoutMs,
        ): Promise<ListPluginsOutput> {
            return client
                .request('listPlugins', {}, timeoutMs)
                .then((response) => response.plugins);
        },
        setPermissionOverride(
            payload: EngineRequestPayload<'setPermissionOverride'>,
        ): Promise<PermissionOverrideOutcome> {
            return client
                .request('setPermissionOverride', payload)
                .then(toPermissionOverrideOutcome);
        },
        readProperties(
            timeoutMs = EngineCommandContracts.readProperties.timeoutMs,
        ): Promise<PropertiesReadOutput> {
            return client.request('readProperties', {}, timeoutMs).then((response) => ({
                properties: response.properties,
                defaults: response.defaults,
            }));
        },
        saveProperties(
            payload: EngineRequestPayload<'saveProperties'>,
        ): Promise<PropertiesSaveOutcome> {
            return client.request('saveProperties', payload).then(toPropertiesSaveOutcome);
        },
        readWorkflowState(
            workflowId: EngineRequestPayload<'readWorkflowState'>['workflowId'],
            timeoutMs = EngineCommandContracts.readWorkflowState.timeoutMs,
        ): Promise<ReadWorkflowStateOutput> {
            return client
                .request('readWorkflowState', { workflowId }, timeoutMs)
                .then((response) => response.entries);
        },
        setWorkflowStateKey(
            payload: EngineRequestPayload<'setWorkflowStateKey'>,
        ): Promise<boolean> {
            return client.request('setWorkflowStateKey', payload).then((response) => response.ok);
        },
        deleteWorkflowStateKey(
            payload: EngineRequestPayload<'deleteWorkflowStateKey'>,
        ): Promise<boolean> {
            return client
                .request('deleteWorkflowStateKey', payload)
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
