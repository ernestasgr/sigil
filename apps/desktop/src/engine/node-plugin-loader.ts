import 'tsx';

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Capability, Manifest } from '@sigil/schema/manifest';

import { parseManifest } from '@sigil/schema/manifest';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { WorkflowContextSchema } from '@sigil/schema/workflow-context';
import { Either, Option } from 'effect';
import type { Bridge } from './bridge.js';
import { FileEventSchema } from './file-watcher-manager.js';
import type { ManifestRegistry } from './manifest-registry.js';
import type {
    KernelDeps,
    NodeHandler,
    NodeHandlerDeps,
    NodeRunResult,
} from './node-handlers/types.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import type { PermissionOverrideStore } from './permission-override-store.js';
import type {
    NodePluginDepsRpc,
    NodePluginWorkerLoadError,
    NodePluginWorkerLoaded,
    NodePluginWorkerRuntimeToMain,
} from './plugin-node-rpc.js';
import { NodePluginWorkerKind, NodePluginWorkerToMainSchema } from './plugin-node-rpc.js';
import { getDeactivationHook } from './workflow-activator.js';

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
          readonly descriptor: { readonly type: string };
          readonly handler: NodeHandler;
      }
    | { readonly ok: false; readonly error: NodePluginLoadError };

export interface NodePluginLoaderDeps {
    readonly manifestRegistry: ManifestRegistry;
    readonly handlerRegistry: NodeHandlerRegistry;
    readonly kernel?: KernelDeps;
    readonly bridge?: Pick<Bridge, 'emit'>;
    readonly permissionOverrides?: PermissionOverrideStore;
    readonly diagnostic?: (message: string) => void;
}

function resolveHandlerPath(pluginDir: string): Option.Option<string> {
    const tsPath = join(pluginDir, 'handler.ts');
    if (existsSync(tsPath)) return Option.some(tsPath);
    const jsPath = join(pluginDir, 'handler.js');
    if (existsSync(jsPath)) return Option.some(jsPath);
    return Option.none();
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

    const handlerPath = Option.getOrUndefined(resolveHandlerPath(pluginDir));
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
            const onMessage = (raw: unknown): void => {
                const parsed = NodePluginWorkerToMainSchema.safeParse(raw);
                if (!parsed.success) {
                    worker.off('message', onMessage);
                    reject(
                        new Error(`Invalid plugin worker load message: ${parsed.error.message}`),
                    );
                    return;
                }
                const msg = parsed.data;
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
    if (Either.isLeft(registerResult)) {
        pluginWorkers.delete(manifest.id);
        worker.terminate().catch(() => {});
        return { ok: false, error: { kind: 'duplicate', dir: pluginDir, pluginId: manifest.id } };
    }

    const handler = createWorkerNodeHandlerProxy(
        manifest.id,
        worker,
        loaded.isTrigger,
        deps.kernel,
        deps.bridge,
        deps.diagnostic,
    );
    deps.handlerRegistry.register(manifest.nodeType, handler);

    return {
        ok: true,
        manifest,
        descriptor: { type: loaded.descriptorType },
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
    bridge?: Pick<Bridge, 'emit'>,
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
    let workerFailure: Error | undefined;

    const publishDiagnostic = (message: string): void => {
        try {
            diagnostic?.(message);
        } catch {
            // A diagnostic subscriber must not prevent pending work from settling.
        }
    };

    const failWorker = (failure: Error): void => {
        if (workerFailure) return;
        workerFailure = failure;
        if (pluginWorkers.get(pluginId) === worker) pluginWorkers.delete(pluginId);
        publishDiagnostic(`[proxy] ${failure.message}`);

        const executions = [...pendingExecutes.values()];
        pendingExecutes.clear();
        for (const pending of executions) pending.reject(failure);

        const activations = [...pendingActivates.values()];
        pendingActivates.clear();
        for (const pending of activations) {
            try {
                Option.getOrUndefined(getDeactivationHook(pending.onEvent))?.(failure.message);
            } catch (err) {
                publishDiagnostic(
                    `[proxy] failed to settle activation after plugin worker failure: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
    };

    const workerFailureFor = (detail: string): Error =>
        new Error(
            `Plugin worker "${pluginId}" stopped unexpectedly (${detail}). Retry the Workflow or restart the plugin.`,
        );

    worker.on('error', (error: Error) => {
        failWorker(workerFailureFor(`error: ${error.message}`));
    });
    worker.on('exit', (code: number) => {
        failWorker(workerFailureFor(`exited with code ${code}`));
    });

    worker.on('message', (raw: unknown) => {
        if (workerFailure) return;
        const parsed = NodePluginWorkerToMainSchema.safeParse(raw);
        if (!parsed.success) {
            const operation =
                isRecord(raw) && typeof raw.operation === 'string'
                    ? ` operation "${raw.operation}"`
                    : '';
            const message =
                `[proxy] plugin "${pluginId}" sent an invalid${operation} message: ` +
                parsed.error.message;
            diagnostic?.(message);
            if (isRecord(raw) && typeof raw.requestId === 'string') {
                postDepsRpcError(worker, raw.requestId, message);
            }
            return;
        }
        const msg = parsed.data;
        if (
            msg.kind === NodePluginWorkerKind.Loaded ||
            msg.kind === NodePluginWorkerKind.LoadError
        ) {
            return;
        }
        const runtimeMsg: NodePluginWorkerRuntimeToMain = msg;
        switch (runtimeMsg.kind) {
            case NodePluginWorkerKind.ExecuteResult:
            case NodePluginWorkerKind.ExecuteError: {
                const pending = pendingExecutes.get(runtimeMsg.requestId);
                if (!pending) break;
                pendingExecutes.delete(runtimeMsg.requestId);
                if (runtimeMsg.kind === NodePluginWorkerKind.ExecuteResult) {
                    const outputCtx = WorkflowContextSchema.safeParse(runtimeMsg.outputCtx);
                    if (!outputCtx.success) {
                        pending.reject(
                            new Error(
                                `Plugin returned an invalid workflow context: ${outputCtx.error.message}`,
                            ),
                        );
                        break;
                    }
                    pending.resolve({
                        outputCtx: outputCtx.data,
                        activePort: runtimeMsg.activePort,
                    });
                } else {
                    if (
                        runtimeMsg.error.startsWith(
                            `[plugin:${pluginId}] denied operation "event.emit"`,
                        )
                    ) {
                        diagnostic?.(`[proxy] ${runtimeMsg.error}`);
                    }
                    pending.reject(new Error(runtimeMsg.error));
                }
                break;
            }
            case NodePluginWorkerKind.ActivateError: {
                const pending = pendingActivates.get(runtimeMsg.requestId);
                if (!pending) break;
                pendingActivates.delete(runtimeMsg.requestId);
                console.warn(
                    `[proxy] activation error for plugin "${pluginId}": ${runtimeMsg.error}`,
                );
                diagnostic?.(
                    `[proxy] activation error for plugin "${pluginId}": ${runtimeMsg.error}`,
                );
                Option.getOrUndefined(getDeactivationHook(pending.onEvent))?.(runtimeMsg.error);
                break;
            }
            case NodePluginWorkerKind.ActivateResult: {
                break;
            }
            case NodePluginWorkerKind.ActivateEvent: {
                const pending = pendingActivates.get(runtimeMsg.requestId);
                if (!pending) break;
                const parsedContext = WorkflowContextSchema.safeParse({
                    event: runtimeMsg.event,
                    payload: runtimeMsg.payload,
                    vars: runtimeMsg.vars ?? {},
                });
                if (!parsedContext.success) {
                    diagnostic?.(
                        `[proxy] plugin "${pluginId}" emitted an invalid workflow context: ${parsedContext.error.message}`,
                    );
                    break;
                }
                pending.onEvent(parsedContext.data);
                break;
            }
            case NodePluginWorkerKind.DepsRpc: {
                handleDepsRpc(
                    runtimeMsg,
                    pendingExecutes,
                    worker,
                    pluginId,
                    kernel,
                    bridge,
                    diagnostic,
                );
                break;
            }
            default:
                assertNever(runtimeMsg);
        }
    });

    const handler: NodeHandler = {
        async execute({ node, ctx }, deps): Promise<NodeRunResult> {
            if (workerFailure) throw workerFailure;
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

                try {
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
                } catch (err) {
                    pendingExecutes.delete(requestId);
                    const failure = workerFailureFor(
                        `could not accept an execute request: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    reject(failure);
                    failWorker(failure);
                }
            });
        },
        ...(isTrigger
            ? {
                  activate: (
                      config: unknown,
                      onEvent: (ctx: WorkflowContext) => void,
                  ): (() => void) => {
                      if (workerFailure) throw workerFailure;
                      const requestId = randomUUID();
                      pendingActivates.set(requestId, { onEvent });
                      try {
                          worker.postMessage({
                              kind: NodePluginWorkerKind.ActivateRequest,
                              requestId,
                              config,
                          });
                      } catch (err) {
                          pendingActivates.delete(requestId);
                          const failure = workerFailureFor(
                              `could not accept an activation request: ${err instanceof Error ? err.message : String(err)}`,
                          );
                          failWorker(failure);
                          throw failure;
                      }
                      let tornDown = false;
                      return () => {
                          if (tornDown) return;
                          tornDown = true;
                          pendingActivates.delete(requestId);
                          if (workerFailure) return;
                          try {
                              worker.postMessage({
                                  kind: NodePluginWorkerKind.Teardown,
                                  requestId,
                              });
                          } catch (err) {
                              failWorker(
                                  workerFailureFor(
                                      `could not accept a teardown request: ${err instanceof Error ? err.message : String(err)}`,
                                  ),
                              );
                          }
                      };
                  },
              }
            : {}),
    };

    return handler;
}

type NodePluginHandlerDepsRpc = Extract<
    NodePluginDepsRpc,
    {
        operation: 'sleep' | 'resolveTemplate' | 'evaluateCondition' | 'matchSwitchCase';
    }
>;

type NodePluginEventRpc = Extract<NodePluginDepsRpc, { operation: 'event.emit' }>;

type NodePluginStateRpc = Extract<
    NodePluginDepsRpc,
    { operation: 'state.get' | 'state.set' | 'state.flush' }
>;

type NodePluginFileWatcherRpc = Extract<
    NodePluginDepsRpc,
    {
        operation:
            | 'fileWatcherManager.registerSubscriber'
            | 'fileWatcherManager.unregisterSubscriber';
    }
>;

type NodePluginCapabilityRpc = Extract<
    NodePluginDepsRpc,
    { operation: 'capabilityBroker.request' }
>;

type NodePluginPrivilegedOperation =
    | NodePluginStateRpc['operation']
    | NodePluginFileWatcherRpc['operation'];

const NODE_PLUGIN_OPERATION_CAPABILITIES = {
    'state.get': 'state.read',
    'state.set': 'state.write',
    'state.flush': 'state.write',
    'fileWatcherManager.registerSubscriber': 'filesystem.read',
    'fileWatcherManager.unregisterSubscriber': 'filesystem.read',
} as const satisfies Readonly<Record<NodePluginPrivilegedOperation, Capability>>;

function assertNever(value: never): never {
    throw new Error(`Unhandled node plugin message: ${JSON.stringify(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postDepsRpcResult(worker: Worker, requestId: string, value: unknown): void {
    worker.postMessage({
        kind: NodePluginWorkerKind.DepsRpcResult,
        requestId,
        value,
    });
}

function postDepsRpcError(worker: Worker, requestId: string, error: string): void {
    worker.postMessage({
        kind: NodePluginWorkerKind.DepsRpcError,
        requestId,
        error,
    });
}

function postDepsRpcValue(worker: Worker, requestId: string, value: unknown): void {
    if (value instanceof Promise) {
        void value
            .then((resolved) => {
                postDepsRpcResult(worker, requestId, resolved);
            })
            .catch((err: unknown) => {
                postDepsRpcError(
                    worker,
                    requestId,
                    err instanceof Error ? err.message : String(err),
                );
            });
        return;
    }
    postDepsRpcResult(worker, requestId, value);
}

function handleDepsRpc(
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
    pluginId: string,
    kernel?: KernelDeps,
    bridge?: Pick<Bridge, 'emit'>,
    diagnostic?: (message: string) => void,
): void {
    switch (msg.operation) {
        case 'event.emit':
            if (!bridge) {
                denyPluginOperation(
                    worker,
                    msg.requestId,
                    pluginId,
                    msg.operation,
                    'Bridge dependency is unavailable',
                    diagnostic,
                );
                return;
            }
            handleEventEmitRpc(msg, pendingExecutes, worker, pluginId, bridge, diagnostic);
            return;
        case 'fileWatcherManager.registerSubscriber':
        case 'fileWatcherManager.unregisterSubscriber':
            if (!kernel) {
                postDepsRpcError(
                    worker,
                    msg.requestId,
                    `Kernel dependency is unavailable for "${msg.operation}"`,
                );
                return;
            }
            handleFileWatcherRpc(msg, worker, pluginId, kernel, diagnostic);
            return;
        case 'capabilityBroker.request':
            if (!kernel) {
                postDepsRpcError(
                    worker,
                    msg.requestId,
                    'Capability Broker dependency is unavailable',
                );
                return;
            }
            handleCapabilityRpc(msg, worker, kernel, pluginId, diagnostic);
            return;
        case 'state.get':
        case 'state.set':
        case 'state.flush':
            if (!kernel) {
                postDepsRpcError(
                    worker,
                    msg.requestId,
                    'Capability Broker dependency is unavailable for Workflow State',
                );
                return;
            }
            handleStateRpc(
                msg,
                pendingExecutes,
                worker,
                pluginId,
                kernel.capabilityBroker,
                diagnostic,
            );
            return;
        case 'sleep':
        case 'resolveTemplate':
        case 'evaluateCondition':
        case 'matchSwitchCase':
            handleNodeHandlerDepsRpc(msg, pendingExecutes, worker);
            return;
        default:
            assertNever(msg);
    }
}

function handleNodeHandlerDepsRpc(
    msg: NodePluginHandlerDepsRpc,
    pendingExecutes: Map<
        string,
        {
            resolve: (result: NodeRunResult) => void;
            reject: (err: Error) => void;
            deps: NodeHandlerDeps;
        }
    >,
    worker: Worker,
): void {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        postDepsRpcError(
            worker,
            msg.requestId,
            'No originating execute request for this dependency RPC',
        );
        return;
    }

    const pending = pendingExecutes.get(executeRequestId);
    if (!pending) {
        postDepsRpcError(worker, msg.requestId, 'No pending execute for this execute request');
        return;
    }

    try {
        const value = callNodeHandlerDepsMethod(pending.deps, msg);
        postDepsRpcValue(worker, msg.requestId, value);
    } catch (err) {
        postDepsRpcError(worker, msg.requestId, err instanceof Error ? err.message : String(err));
    }
}

function handleEventEmitRpc(
    msg: NodePluginEventRpc,
    pendingExecutes: Map<
        string,
        {
            resolve: (result: NodeRunResult) => void;
            reject: (err: Error) => void;
            deps: NodeHandlerDeps;
        }
    >,
    worker: Worker,
    pluginId: string,
    bridge: Pick<Bridge, 'emit'>,
    diagnostic?: (message: string) => void,
): void {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        denyPluginOperation(
            worker,
            msg.requestId,
            pluginId,
            msg.operation,
            'No originating execute request',
            diagnostic,
        );
        return;
    }

    if (!pendingExecutes.has(executeRequestId)) {
        denyPluginOperation(
            worker,
            msg.requestId,
            pluginId,
            msg.operation,
            'No pending execute request',
            diagnostic,
        );
        return;
    }

    try {
        const [eventName, payload] = msg.args;
        const result = bridge.emit(pluginId, { eventName, payload });
        if (Either.isLeft(result)) {
            const reason = `${result.left.kind} for event "${eventName}"`;
            denyPluginOperation(worker, msg.requestId, pluginId, msg.operation, reason, diagnostic);
            return;
        }
        postDepsRpcResult(worker, msg.requestId, undefined);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        denyPluginOperation(worker, msg.requestId, pluginId, msg.operation, reason, diagnostic);
    }
}

function denyPluginOperation(
    worker: Worker,
    requestId: string,
    pluginId: string,
    operation: string,
    reason: string,
    diagnostic?: (message: string) => void,
): void {
    const message = `[plugin:${pluginId}] denied operation "${operation}": ${reason}`;
    diagnostic?.(message);
    postDepsRpcError(worker, requestId, `Permission denied: ${reason} (operation "${operation}")`);
}

function callNodeHandlerDepsMethod(deps: NodeHandlerDeps, msg: NodePluginHandlerDepsRpc): unknown {
    switch (msg.operation) {
        case 'sleep':
            return deps.sleep(...msg.args);
        case 'resolveTemplate':
            return deps.resolveTemplate(...msg.args);
        case 'evaluateCondition':
            return deps.evaluateCondition(...msg.args);
        case 'matchSwitchCase':
            return deps.matchSwitchCase(...msg.args);
        default:
            return assertNever(msg);
    }
}

function handleStateRpc(
    msg: NodePluginStateRpc,
    pendingExecutes: Map<
        string,
        {
            resolve: (result: NodeRunResult) => void;
            reject: (err: Error) => void;
            deps: NodeHandlerDeps;
        }
    >,
    worker: Worker,
    pluginId: string,
    capabilityBroker: KernelDeps['capabilityBroker'],
    diagnostic?: (message: string) => void,
): void {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        denyPluginOperation(
            worker,
            msg.requestId,
            pluginId,
            msg.operation,
            'No originating execute request',
            diagnostic,
        );
        return;
    }

    const pending = pendingExecutes.get(executeRequestId);
    if (!pending) {
        denyPluginOperation(
            worker,
            msg.requestId,
            pluginId,
            msg.operation,
            'No pending execute request',
            diagnostic,
        );
        return;
    }

    try {
        const permission = authorizePluginOperation(capabilityBroker, pluginId, msg.operation);
        if (Either.isLeft(permission)) {
            denyPluginOperation(
                worker,
                msg.requestId,
                pluginId,
                msg.operation,
                permission.left.capability,
                diagnostic,
            );
            return;
        }

        const value = callWorkflowStateMethod(pending.deps.state, msg);
        postDepsRpcValue(worker, msg.requestId, value);
    } catch (err) {
        postDepsRpcError(worker, msg.requestId, err instanceof Error ? err.message : String(err));
    }
}

function callWorkflowStateMethod(
    state: NodeHandlerDeps['state'],
    msg: NodePluginStateRpc,
): unknown {
    switch (msg.operation) {
        case 'state.get':
            return state.get(...msg.args);
        case 'state.set':
            return state.set(...msg.args);
        case 'state.flush':
            return state.flush(...msg.args);
        default:
            return assertNever(msg);
    }
}

function handleFileWatcherRpc(
    msg: NodePluginFileWatcherRpc,
    worker: Worker,
    pluginId: string,
    kernel: KernelDeps,
    diagnostic?: (message: string) => void,
): void {
    try {
        const permission = authorizePluginOperation(
            kernel.capabilityBroker,
            pluginId,
            msg.operation,
        );
        if (Either.isLeft(permission)) {
            denyPluginOperation(
                worker,
                msg.requestId,
                pluginId,
                msg.operation,
                permission.left.capability,
                diagnostic,
            );
            return;
        }

        switch (msg.operation) {
            case 'fileWatcherManager.registerSubscriber': {
                const [subscriber, callbackId] = msg.args;
                kernel.fileWatcherManager.registerSubscriber(subscriber, (fileEvent: unknown) => {
                    const parsedEvent = FileEventSchema.safeParse(fileEvent);
                    if (!parsedEvent.success) return;
                    worker.postMessage({
                        kind: NodePluginWorkerKind.CallbackInvoke,
                        callbackId,
                        args: [parsedEvent.data],
                    });
                });
                postDepsRpcResult(worker, msg.requestId, undefined);
                return;
            }
            case 'fileWatcherManager.unregisterSubscriber': {
                const [id] = msg.args;
                kernel.fileWatcherManager.unregisterSubscriber(id);
                postDepsRpcResult(worker, msg.requestId, undefined);
                return;
            }
            default:
                assertNever(msg);
        }
    } catch (err) {
        postDepsRpcError(worker, msg.requestId, err instanceof Error ? err.message : String(err));
    }
}

function authorizePluginOperation(
    capabilityBroker: KernelDeps['capabilityBroker'],
    pluginId: string,
    operation: NodePluginPrivilegedOperation,
): ReturnType<KernelDeps['capabilityBroker']['request']> {
    return capabilityBroker.request({
        pluginId,
        capability: NODE_PLUGIN_OPERATION_CAPABILITIES[operation],
    });
}

function handleCapabilityRpc(
    msg: NodePluginCapabilityRpc,
    worker: Worker,
    kernel: KernelDeps,
    pluginId: string,
    diagnostic?: (message: string) => void,
): void {
    try {
        const capability = msg.args[0];
        const result = kernel.capabilityBroker.request({ pluginId, capability });
        if (Either.isLeft(result)) {
            diagnostic?.(
                `[plugin:${pluginId}] denied operation "${msg.operation}": ${result.left.capability}`,
            );
        }
        const value = Either.isRight(result)
            ? { ok: true as const }
            : { ok: false as const, error: result.left };
        postDepsRpcResult(worker, msg.requestId, value);
    } catch (err) {
        postDepsRpcError(worker, msg.requestId, err instanceof Error ? err.message : String(err));
    }
}

export function updatePluginPermissions(
    pluginId: string,
    permissions: readonly Capability[],
): void {
    const worker = pluginWorkers.get(pluginId);
    if (!worker) return;
    try {
        worker.postMessage({
            kind: NodePluginWorkerKind.UpdatePermissions,
            permissions: [...permissions],
        });
    } catch {
        pluginWorkers.delete(pluginId);
    }
}
