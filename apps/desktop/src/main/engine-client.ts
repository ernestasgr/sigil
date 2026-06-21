import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { EngineChannel, type EngineMessage, type EnginePong } from '../shared/ipc-channels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type EngineHandle = {
    ping: (timeoutMs?: number) => Promise<EnginePong>;
    terminate: () => Promise<number>;
    onReady: (handler: () => void) => void;
};

export function spawnEngine(): EngineHandle {
    const workerPath = resolvePath(__dirname, 'worker.js');
    const worker = new Worker(workerPath);

    const pendingPings = new Map<string, { resolve: (pong: EnginePong) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
    const readyHandlers = new Set<() => void>();
    let ready = false;

    function rejectAllPending(reason: string) {
        for (const [id, entry] of pendingPings) {
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
    };
}
