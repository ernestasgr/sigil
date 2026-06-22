import { parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
    PluginLifecycleKind,
    PluginRpcKind,
    type EngineToPluginMessage,
    type PluginRpcRequest,
    type PluginToEngineMessage,
} from './plugin-rpc.js';
import { createPluginSandbox, type PluginSandboxRpc, type RpcResult } from './plugin-sandbox.js';

const PluginWorkerDataSchema = z.object({
    pluginId: z.string().min(1),
    code: z.string(),
});
type PluginWorkerData = z.infer<typeof PluginWorkerDataSchema>;

if (!parentPort) {
    throw new Error('plugin worker must be spawned as a worker_thread');
}

const port = parentPort;
const parsedData = PluginWorkerDataSchema.parse(workerData);
const data: PluginWorkerData = parsedData;

const pending = new Map<
    string,
    { resolve: (result: RpcResult) => void; reject: (err: Error) => void }
>();

function send(message: PluginToEngineMessage): void {
    port.postMessage(message);
}

function rpcCall(request: PluginRpcRequest): Promise<RpcResult> {
    return new Promise((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject });
        send(request);
    });
}

const rpc: PluginSandboxRpc = {
    eventEmit: (eventName, payload) =>
        rpcCall({
            kind: PluginRpcKind.EventEmit,
            requestId: randomUUID(),
            pluginId: data.pluginId,
            eventName,
            payload,
        }),
    stateGet: (key) =>
        rpcCall({
            kind: PluginRpcKind.StateGet,
            requestId: randomUUID(),
            pluginId: data.pluginId,
            key,
        }),
    stateSet: (key, value) =>
        rpcCall({
            kind: PluginRpcKind.StateSet,
            requestId: randomUUID(),
            pluginId: data.pluginId,
            key,
            value,
        }),
    log: (message) =>
        rpcCall({
            kind: PluginRpcKind.Log,
            requestId: randomUUID(),
            pluginId: data.pluginId,
            message,
        }),
};

port.on('message', (message: EngineToPluginMessage) => {
    if (message.kind === PluginLifecycleKind.Result) {
        const entry = pending.get(message.requestId);
        if (entry) {
            pending.delete(message.requestId);
            const result: RpcResult = message.ok
                ? { ok: true, value: message.value }
                : { ok: false, error: message.error };
            entry.resolve(result);
        }
    }
});

const sandbox = createPluginSandbox(rpc);

try {
    sandbox.run(data.code);
    send({ kind: PluginLifecycleKind.Ready, pluginId: data.pluginId });
} catch (err) {
    send({
        kind: PluginLifecycleKind.Error,
        pluginId: data.pluginId,
        message: err instanceof Error ? err.message : String(err),
    });
}
