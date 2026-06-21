import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    EngineChannel,
    type EngineFireTestEvent,
    type EngineMessage,
    type EnginePong,
    type EngineToggleWorkflow,
} from '../shared/ipc-channels.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    readonly ping: (timeoutMs?: number) => Promise<EnginePong>;
    readonly fireTestEvent: () => void;
    readonly toggleWorkflow: (id: string) => void;
    readonly terminate: () => Promise<number>;
    readonly onReady: (handler: () => void) => void;
    readonly onLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
};

export function spawnEngine(): EngineHandle {
    const workerPath = resolvePath(__dirname, 'worker.js');
    const worker = new Worker(workerPath);

    const pendingPings = new Map<
        string,
        { resolve: (pong: EnginePong) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
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
        toggleWorkflow(id: string): void {
            const toggle: EngineToggleWorkflow = { type: EngineChannel.ToggleWorkflow, id };
            worker.postMessage(toggle);
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
