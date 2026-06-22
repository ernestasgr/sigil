import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { z } from 'zod';

import { parseManifest } from '@sigil/schema/manifest';
import type { Manifest } from '@sigil/schema/manifest';

import type { Bridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import type { EventBus } from './event-bus.js';
import type { ManifestRegistry } from './manifest-registry.js';
import {
    PluginLifecycleKind,
    PluginRpcKind,
    type EngineToPluginMessage,
    type PluginRpcRequest,
    type PluginToEngineMessage,
} from './plugin-rpc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PluginLoadError =
    | { readonly kind: 'invalid_manifest'; readonly error: string }
    | { readonly kind: 'duplicate'; readonly pluginId: string }
    | { readonly kind: 'worker_error'; readonly error: string };

export type PluginLoadResult =
    | { readonly ok: true; readonly handle: PluginHandle }
    | { readonly ok: false; readonly error: PluginLoadError };

export interface PluginHandle {
    readonly pluginId: string;
    readonly manifest: Manifest;
    readonly terminate: () => Promise<void>;
}

export interface PluginStateStore {
    readonly get: (pluginId: string, key: string) => unknown | undefined;
    readonly set: (pluginId: string, key: string, value: unknown) => void;
}

export interface PluginLoaderDeps {
    readonly bus: EventBus;
    readonly registry: ManifestRegistry;
    readonly bridge: Bridge;
    readonly broker: CapabilityBroker;
    readonly stateStore: PluginStateStore;
    readonly workerPath?: string;
}

export function createInMemoryPluginStateStore(): PluginStateStore {
    const store = new Map<string, Map<string, unknown>>();
    return {
        get: (pluginId, key) => store.get(pluginId)?.get(key),
        set: (pluginId, key, value) => {
            let pluginState = store.get(pluginId);
            if (!pluginState) {
                pluginState = new Map();
                store.set(pluginId, pluginState);
            }
            pluginState.set(key, value);
        },
    };
}

function resolveWorkerPath(custom?: string): string {
    if (custom) return custom;
    return resolvePath(__dirname, 'plugin-worker.js');
}

const PluginEventPayloadSchema = z.record(z.string(), z.unknown());

export function handleRpcRequest(
    request: PluginRpcRequest,
    deps: PluginLoaderDeps,
): EngineToPluginMessage {
    switch (request.kind) {
        case PluginRpcKind.EventEmit: {
            const payloadResult = PluginEventPayloadSchema.safeParse(request.payload);
            if (!payloadResult.success) {
                return {
                    kind: PluginLifecycleKind.Result,
                    requestId: request.requestId,
                    ok: false,
                    error: 'invalid_payload',
                };
            }
            const result = deps.bridge.emit(request.pluginId, {
                eventName: request.eventName,
                payload: payloadResult.data,
            });
            return result.ok
                ? {
                      kind: PluginLifecycleKind.Result,
                      requestId: request.requestId,
                      ok: true,
                      value: undefined,
                  }
                : {
                      kind: PluginLifecycleKind.Result,
                      requestId: request.requestId,
                      ok: false,
                      error: result.error.kind,
                  };
        }
        case PluginRpcKind.Log: {
            const result = deps.bridge.log(request.pluginId, request.message);
            return result.ok
                ? {
                      kind: PluginLifecycleKind.Result,
                      requestId: request.requestId,
                      ok: true,
                      value: undefined,
                  }
                : {
                      kind: PluginLifecycleKind.Result,
                      requestId: request.requestId,
                      ok: false,
                      error: result.error.kind,
                  };
        }
        case PluginRpcKind.StateGet: {
            const value = deps.stateStore.get(request.pluginId, request.key);
            return {
                kind: PluginLifecycleKind.Result,
                requestId: request.requestId,
                ok: true,
                value,
            };
        }
        case PluginRpcKind.StateSet: {
            deps.stateStore.set(request.pluginId, request.key, request.value);
            return {
                kind: PluginLifecycleKind.Result,
                requestId: request.requestId,
                ok: true,
                value: undefined,
            };
        }
        default: {
            const _exhaustive: never = request;
            void _exhaustive;
            return {
                kind: PluginLifecycleKind.Result,
                requestId: '',
                ok: false,
                error: 'unknown_rpc',
            };
        }
    }
}

export function createPluginLoader(deps: PluginLoaderDeps) {
    const workerPath = resolveWorkerPath(deps.workerPath);

    async function load(rawManifest: unknown, code: string): Promise<PluginLoadResult> {
        const parsed = parseManifest(rawManifest);
        if (!parsed.ok) {
            return { ok: false, error: { kind: 'invalid_manifest', error: parsed.error } };
        }
        const manifest = parsed.value;

        if (deps.registry.has(manifest.id)) {
            return { ok: false, error: { kind: 'duplicate', pluginId: manifest.id } };
        }

        const registerResult = deps.registry.register(manifest);
        if (!registerResult.ok) {
            return { ok: false, error: { kind: 'duplicate', pluginId: manifest.id } };
        }

        const worker = new Worker(workerPath, {
            workerData: { pluginId: manifest.id, code },
            execArgv: process.execArgv.includes('--import')
                ? process.execArgv
                : ['--import', 'tsx'],
        });

        return new Promise<PluginLoadResult>((resolve) => {
            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    deps.registry.unregister(manifest.id);
                    resolve({
                        ok: false,
                        error: { kind: 'worker_error', error: 'plugin worker startup timeout' },
                    });
                }
            }, 10000);

            worker.on('message', (message: PluginToEngineMessage) => {
                if (message.kind === PluginLifecycleKind.Ready) {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        resolve({
                            ok: true,
                            handle: {
                                pluginId: manifest.id,
                                manifest,
                                terminate: async () => {
                                    await worker.terminate();
                                },
                            },
                        });
                    }
                    return;
                }

                if (message.kind === PluginLifecycleKind.Error) {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        deps.registry.unregister(manifest.id);
                        resolve({
                            ok: false,
                            error: { kind: 'worker_error', error: message.message },
                        });
                    } else {
                        deps.bus.next({
                            name: 'log.output',
                            payload: {
                                message: `[plugin:${message.pluginId}] error: ${message.message}`,
                            },
                        });
                    }
                    return;
                }

                const response = handleRpcRequest(message, deps);
                worker.postMessage(response);
            });

            worker.on('error', (err: Error) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    deps.registry.unregister(manifest.id);
                    resolve({
                        ok: false,
                        error: { kind: 'worker_error', error: err.message },
                    });
                } else {
                    deps.bus.next({
                        name: 'log.output',
                        payload: {
                            message: `[plugin:${manifest.id}] worker error: ${err.message}`,
                        },
                    });
                }
            });

            worker.on('exit', (code: number) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    deps.registry.unregister(manifest.id);
                    resolve({
                        ok: false,
                        error: {
                            kind: 'worker_error',
                            error: `plugin worker exited unexpectedly with code ${code}`,
                        },
                    });
                }
            });
        });
    }

    return { load };
}

export type PluginLoader = ReturnType<typeof createPluginLoader>;
