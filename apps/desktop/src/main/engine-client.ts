import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { app } from 'electron';

import type { CompiledPipeline } from '@sigil/schema';

import {
    EngineChannel,
    type EngineCreateWorkflow,
    type EngineDeleteWorkflow,
    type EngineFireTestEvent,
    type EngineGetWorkflow,
    type EngineGetWorkflowResult,
    type EngineMessage,
    type EnginePong,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
} from '../shared/ipc-channels.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<EnginePong>;
    readonly fireTestEvent: () => void;
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
    readonly terminate: () => Promise<number>;
    readonly onReady: (handler: () => void) => void;
    readonly onLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
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
    const readyHandlers = new Set<() => void>();
    const logHandlers = new Set<(line: string) => void>();
    const workflowsListHandlers = new Set<(workflows: readonly WorkflowSummary[]) => void>();
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
    };
}
