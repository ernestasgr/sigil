import 'tsx';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

import { parseManifest } from '@sigil/schema/manifest';
import type { Manifest } from '@sigil/schema/manifest';
import type { NodeDescriptor } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { ManifestRegistry } from './manifest-registry.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import type {
    KernelDeps,
    NodeHandler,
    NodeHandlerDeps,
    NodeRunResult,
} from './node-handlers/types.js';
import type { PermissionOverrideStore } from './permission-override-store.js';
import type {
    NodePluginWorkerLoaded,
    NodePluginWorkerLoadError,
    NodePluginWorkerToMain,
    NodePluginDepsRpc,
} from './plugin-node-rpc.js';
import { NodePluginWorkerKind } from './plugin-node-rpc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pluginWorkers = new Map<string, Worker>();

export type NodePluginLoadError =
    | { readonly kind: 'invalid_manifest'; readonly dir: string; readonly error: string }
    | { readonly kind: 'missing_manifest'; readonly dir: string }
    | { readonly kind: 'missing_handler'; readonly dir: string }
    | { readonly kind: 'missing_node_type'; readonly dir: string }
    | { readonly kind: 'invalid_handler_module'; readonly dir: string; readonly error: string }
    | {
          readonly kind: 'type_mismatch';
          readonly dir: string;
          readonly manifestType: string;
          readonly descriptorType: string;
      }
    | { readonly kind: 'duplicate'; readonly dir: string; readonly pluginId: string }
    | { readonly kind: 'duplicate_type'; readonly dir: string; readonly nodeType: string }
    | { readonly kind: 'import_error'; readonly dir: string; readonly error: string }
    | { readonly kind: 'worker_error'; readonly dir: string; readonly error: string };

export type NodePluginLoadResult =
    | {
          readonly ok: true;
          readonly manifest: Manifest;
          readonly descriptor: NodeDescriptor<string, unknown>;
          readonly handler: NodeHandler;
      }
    | { readonly ok: false; readonly error: NodePluginLoadError };

export interface NodePluginLoaderDeps {
    readonly manifestRegistry: ManifestRegistry;
    readonly handlerRegistry: NodeHandlerRegistry;
    readonly kernel?: KernelDeps;
    readonly permissionOverrides?: PermissionOverrideStore;
    readonly diagnostic?: (message: string) => void;
}

function resolveHandlerPath(pluginDir: string): string | undefined {
    const tsPath = join(pluginDir, 'handler.ts');
    if (existsSync(tsPath)) return tsPath;
    const jsPath = join(pluginDir, 'handler.js');
    if (existsSync(jsPath)) return jsPath;
    return undefined;
}

// ─── Unified plugin loader (Worker-based for all plugins) ────

export async function loadNodePlugin(
    pluginDir: string,
    deps: NodePluginLoaderDeps,
): Promise<NodePluginLoadResult> {
    const manifestPath = join(pluginDir, 'plugin.manifest.json');
    if (!existsSync(manifestPath)) {
        return { ok: false, error: { kind: 'missing_manifest', dir: pluginDir } };
    }

    let rawManifest: unknown;
    try {
        rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        return {
            ok: false,
            error: {
                kind: 'invalid_manifest',
                dir: pluginDir,
                error: err instanceof Error ? err.message : String(err),
            },
        };
    }
    const parsed = parseManifest(rawManifest);
    if (!parsed.ok) {
        return {
            ok: false,
            error: { kind: 'invalid_manifest', dir: pluginDir, error: parsed.error },
        };
    }
    const manifest = parsed.value;

    if (!manifest.nodeType) {
        return { ok: false, error: { kind: 'missing_node_type', dir: pluginDir } };
    }

    if (deps.manifestRegistry.has(manifest.id)) {
        return { ok: false, error: { kind: 'duplicate', dir: pluginDir, pluginId: manifest.id } };
    }

    if (deps.handlerRegistry.has(manifest.nodeType)) {
        return {
            ok: false,
            error: { kind: 'duplicate_type', dir: pluginDir, nodeType: manifest.nodeType },
        };
    }

    const handlerPath = resolveHandlerPath(pluginDir);
    if (!handlerPath) {
        return { ok: false, error: { kind: 'missing_handler', dir: pluginDir } };
    }

    const effectivePermissions = deps.permissionOverrides?.has(manifest.id)
        ? deps.permissionOverrides.get(manifest.id)
        : manifest.permissions;

    // Spawn Worker to load and run the handler in a sandboxed context
    // Try compiled JS first (dev/production), fall back to source TS (tests)
    const jsPath = join(__dirname, 'plugin-worker.js');
    const tsPath = join(__dirname, 'plugin-node-worker.ts');
    const workerScriptPath = existsSync(jsPath) ? jsPath : tsPath;

    const worker = new Worker(workerScriptPath, {
        workerData: {
            pluginId: manifest.id,
            manifestNodeType: manifest.nodeType,
            handlerPath: resolvePath(handlerPath),
            manifestPermissions: manifest.permissions,
            permissions: effectivePermissions,
        },
        execArgv: ['--import', 'tsx/esm'],
        eval: false,
    });

    pluginWorkers.set(manifest.id, worker);

    const loaded = await new Promise<NodePluginWorkerLoaded | NodePluginWorkerLoadError>(
        (resolve, reject) => {
            const onMessage = (msg: NodePluginWorkerToMain): void => {
                if (
                    msg.kind === NodePluginWorkerKind.Loaded ||
                    msg.kind === NodePluginWorkerKind.LoadError
                ) {
                    worker.off('message', onMessage);
                    resolve(msg);
                }
            };
            worker.on('message', onMessage);
            worker.on('error', (err) => {
                reject(err);
            });
            worker.on('exit', (code) => {
                reject(new Error(`Worker exited with code ${code} before sending load result`));
            });
        },
    );

    if (loaded.kind === NodePluginWorkerKind.LoadError) {
        pluginWorkers.delete(manifest.id);
        worker.terminate().catch(() => {});
        return {
            ok: false,
            error: { kind: 'worker_error', dir: pluginDir, error: loaded.error },
        };
    }

    const registerResult = deps.manifestRegistry.register(manifest);
    if (!registerResult.ok) {
        pluginWorkers.delete(manifest.id);
        worker.terminate().catch(() => {});
        return { ok: false, error: { kind: 'duplicate', dir: pluginDir, pluginId: manifest.id } };
    }

    const handler = createWorkerNodeHandlerProxy(
        manifest.id,
        worker,
        loaded.isTrigger,
        deps.kernel,
        deps.diagnostic,
    );
    deps.handlerRegistry.register(manifest.nodeType, handler);

    return {
        ok: true,
        manifest,
        descriptor: { type: loaded.descriptorType } as NodeDescriptor<string, unknown>,
        handler,
    };
}

export async function loadNodePlugins(
    pluginsDir: string,
    deps: NodePluginLoaderDeps,
): Promise<readonly NodePluginLoadResult[]> {
    if (!existsSync(pluginsDir)) return [];

    const entries = readdirSync(pluginsDir, { withFileTypes: true });
    const pluginDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(pluginsDir, entry.name));

    const results: NodePluginLoadResult[] = [];
    for (const dir of pluginDirs) {
        const result = await loadNodePlugin(dir, deps);
        results.push(result);
    }
    return results;
}

// ─── Worker proxy handler ────────────────────────────────────

function createWorkerNodeHandlerProxy(
    pluginId: string,
    worker: Worker,
    isTrigger: boolean,
    kernel?: KernelDeps,
    diagnostic?: (message: string) => void,
): NodeHandler {
    const pendingExecutes = new Map<
        string,
        {
            resolve: (result: NodeRunResult) => void;
            reject: (err: Error) => void;
            deps: NodeHandlerDeps;
        }
    >();
    const pendingActivates = new Map<string, { onEvent: (ctx: WorkflowContext) => void }>();

    worker.on('message', (raw: unknown) => {
        const msg = raw as NodePluginWorkerToMain;
        switch (msg.kind) {
            case NodePluginWorkerKind.ExecuteResult:
            case NodePluginWorkerKind.ExecuteError: {
                const pending = pendingExecutes.get(msg.requestId);
                if (!pending) break;
                pendingExecutes.delete(msg.requestId);
                if (msg.kind === NodePluginWorkerKind.ExecuteResult) {
                    pending.resolve({
                        outputCtx: msg.outputCtx as WorkflowContext,
                        activePort: msg.activePort,
                    });
                } else {
                    pending.reject(new Error(msg.error));
                }
                break;
            }
            case NodePluginWorkerKind.ActivateError: {
                const pending = pendingActivates.get(msg.requestId);
                if (!pending) break;
                console.warn(`[proxy] activation error for plugin "${pluginId}": ${msg.error}`);
                diagnostic?.(`[proxy] activation error for plugin "${pluginId}": ${msg.error}`);
                break;
            }
            case NodePluginWorkerKind.ActivateResult: {
                break;
            }
            case NodePluginWorkerKind.ActivateEvent: {
                const pending = pendingActivates.get(msg.requestId);
                if (!pending) break;
                const ctx: WorkflowContext = {
                    event: msg.event,
                    payload: msg.payload as Record<string, unknown>,
                    vars: (msg.vars ?? {}) as Record<string, unknown>,
                };
                pending.onEvent(ctx);
                break;
            }
            case NodePluginWorkerKind.DepsRpc: {
                handleDepsRpc(pluginId, msg, pendingExecutes, worker, kernel);
                break;
            }
        }
    });

    const handler: NodeHandler = {
        async execute({ node, ctx }, deps): Promise<NodeRunResult> {
            const requestId = randomUUID();
            return new Promise<NodeRunResult>((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (pendingExecutes.has(requestId)) {
                        pendingExecutes.delete(requestId);
                        reject(new Error('Execute request timed out after 30s'));
                    }
                }, 30_000);

                pendingExecutes.set(requestId, {
                    resolve: (result) => {
                        clearTimeout(timer);
                        resolve(result);
                    },
                    reject: (err) => {
                        clearTimeout(timer);
                        reject(err);
                    },
                    deps,
                });

                worker.postMessage({
                    kind: NodePluginWorkerKind.ExecuteRequest,
                    requestId,
                    nodeType: node.type,
                    nodeConfig: node.config,
                    ctx,
                    deps: {
                        collisionSuffixStyle: deps.collisionSuffixStyle,
                    },
                });
            });
        },
        ...(isTrigger
            ? {
                  activate: (
                      config: unknown,
                      onEvent: (ctx: WorkflowContext) => void,
                  ): (() => void) => {
                      const requestId = randomUUID();
                      pendingActivates.set(requestId, { onEvent });
                      worker.postMessage({
                          kind: NodePluginWorkerKind.ActivateRequest,
                          requestId,
                          config,
                      });
                      return () => {
                          worker.postMessage({ kind: NodePluginWorkerKind.Teardown });
                      };
                  },
              }
            : {}),
    };

    return handler;
}

function handleDepsRpc(
    pluginId: string,
    msg: NodePluginDepsRpc,
    pendingExecutes: Map<
        string,
        {
            resolve: (result: NodeRunResult) => void;
            reject: (err: Error) => void;
            deps: NodeHandlerDeps;
        }
    >,
    worker: Worker,
    kernel?: KernelDeps,
): void {
    if (kernel && msg.method.startsWith('fileWatcherManager.')) {
        handleFileWatcherRpc(pluginId, msg, worker, kernel);
        return;
    }

    if (kernel && msg.method.startsWith('capabilityBroker.')) {
        void handleCapabilityRpc(msg, worker, kernel);
        return;
    }

    const pending = pendingExecutes.get(msg.requestId);
    if (!pending) {
        worker.postMessage({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: msg.requestId,
            error: 'No pending execute for this request',
        });
        return;
    }

    try {
        const value = callDepsMethod(pending.deps, msg.method, msg.args);
        if (value instanceof Promise) {
            value
                .then((resolved) => {
                    worker.postMessage({
                        kind: NodePluginWorkerKind.DepsRpcResult,
                        requestId: msg.requestId,
                        value: resolved,
                    });
                })
                .catch((err) => {
                    worker.postMessage({
                        kind: NodePluginWorkerKind.DepsRpcError,
                        requestId: msg.requestId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
        } else {
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcResult,
                requestId: msg.requestId,
                value,
            });
        }
    } catch (err) {
        worker.postMessage({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

function handleFileWatcherRpc(
    _pluginId: string,
    msg: NodePluginDepsRpc,
    worker: Worker,
    kernel: KernelDeps,
): void {
    try {
        if (msg.method === 'fileWatcherManager.registerSubscriber') {
            const [subscriber, callbackId] = msg.args as [unknown, string];
            kernel.fileWatcherManager.registerSubscriber(
                subscriber as never,
                (fileEvent: unknown) => {
                    worker.postMessage({
                        kind: NodePluginWorkerKind.CallbackInvoke,
                        callbackId,
                        args: [fileEvent],
                    });
                },
            );
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcResult,
                requestId: msg.requestId,
                value: undefined,
            });
        } else if (msg.method === 'fileWatcherManager.unregisterSubscriber') {
            const [id] = msg.args as [string];
            kernel.fileWatcherManager.unregisterSubscriber(id);
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcResult,
                requestId: msg.requestId,
                value: undefined,
            });
        } else {
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcError,
                requestId: msg.requestId,
                error: `Unknown fileWatcherManager method: ${msg.method}`,
            });
        }
    } catch (err) {
        worker.postMessage({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function handleCapabilityRpc(
    msg: NodePluginDepsRpc,
    worker: Worker,
    kernel: KernelDeps,
): Promise<void> {
    try {
        if (msg.method === 'capabilityBroker.request') {
            const [req] = msg.args as [Parameters<KernelDeps['capabilityBroker']['request']>[0]];
            const result = kernel.capabilityBroker.request(req);
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcResult,
                requestId: msg.requestId,
                value: result,
            });
        } else {
            worker.postMessage({
                kind: NodePluginWorkerKind.DepsRpcError,
                requestId: msg.requestId,
                error: `Unknown capabilityBroker method: ${msg.method}`,
            });
        }
    } catch (err) {
        worker.postMessage({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export function updatePluginPermissions(pluginId: string, permissions: readonly string[]): void {
    const worker = pluginWorkers.get(pluginId);
    if (!worker) return;
    try {
        worker.postMessage({
            kind: NodePluginWorkerKind.UpdatePermissions,
            permissions,
        });
    } catch {
        pluginWorkers.delete(pluginId);
    }
}

function callDepsMethod(deps: NodeHandlerDeps, method: string, args: readonly unknown[]): unknown {
    const parts = method.split('.');
    let current: unknown = deps as unknown as Record<string, unknown>;
    for (const part of parts) {
        if (typeof current !== 'object' || current === null) {
            throw new Error(`Cannot resolve method "${method}": "${part}" is not an object`);
        }
        current = (current as Record<string, unknown>)[part];
    }
    if (typeof current !== 'function') {
        throw new Error(`Deps method "${method}" is not a function`);
    }
    return (current as (...args: unknown[]) => unknown)(...args);
}
