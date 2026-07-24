import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { SerializableNodeContract } from '@sigil/schema/node-contract';
import { type WorkflowContext, WorkflowContextSchema } from '@sigil/schema/workflow-context';
import { Option } from 'effect';
import type { EngineDiagnosticPayload } from '../../shared/event-payload-schemas.js';
import type { Bridge } from '../events/bridge.js';
import type {
    KernelDeps,
    NodeHandler,
    NodeHandlerDeps,
    NodeRunResult,
} from '../node-handlers/types.js';
import { getDeactivationHook } from '../workflow/workflow-activator.js';
import type { NodePluginPreparation } from './node-plugin-preparation.js';
import {
    createNodePluginRpcRouter,
    type NodePluginRpcExecution,
} from './node-plugin-rpc-router.js';
import {
    createPluginExecutionState,
    type PluginExecutionState,
    transitionPluginExecution,
} from './plugin-execution-state.js';
import type {
    NodePluginWorkerLoadError,
    NodePluginWorkerLoaded,
    NodePluginWorkerRuntimeToMain,
} from './plugin-node-rpc.js';
import { NodePluginWorkerKind, NodePluginWorkerToMainSchema } from './plugin-node-rpc.js';

export const PLUGIN_WORKER_READY_TIMEOUT_MS = 30_000;
export const PLUGIN_EXECUTION_TIMEOUT_MS = 30_000;
export const PLUGIN_EXECUTION_CANCEL_GRACE_PERIOD_MS = 1_000;

export interface NodePluginWorkerSupervisorOptions {
    readonly diagnostic?: (message: string) => void;
    readonly diagnosticEvent?: (event: EngineDiagnosticPayload) => void;
}

export interface NodePluginWorkerLoadDependencies {
    readonly kernel?: KernelDeps;
    readonly bridge?: Pick<Bridge, 'emit'>;
    readonly diagnostic?: (message: string) => void;
    readonly diagnosticEvent?: (event: EngineDiagnosticPayload) => void;
}

export interface NodePluginWorkerLoadOptions {
    /** Replace an existing worker for the legacy module-level compatibility facade. */
    readonly replaceExisting?: boolean;
}

export type NodePluginWorkerLoadResult =
    | {
          readonly ok: true;
          readonly handler: NodeHandler;
          readonly descriptorType: string;
          readonly isTrigger: boolean;
          readonly contract?: SerializableNodeContract;
          readonly propertyDescriptors?: NodePluginWorkerLoaded['propertyDescriptors'];
      }
    | {
          readonly ok: false;
          readonly kind: 'already_loaded';
          readonly error: string;
      }
    | {
          readonly ok: false;
          readonly kind: 'worker_error';
          readonly error: string;
          readonly contractError?: string;
          readonly propertyError?: NodePluginWorkerLoadError['propertyError'];
      };

export interface NodePluginWorkerSupervisor {
    readonly load: (
        preparation: NodePluginPreparation,
        deps: NodePluginWorkerLoadDependencies,
        options?: NodePluginWorkerLoadOptions,
    ) => Promise<NodePluginWorkerLoadResult>;
    readonly disposePlugin: (pluginId: string) => Promise<void>;
    readonly updatePermissions: (
        pluginId: string,
        permissions: NodePluginPreparation['permissions'],
    ) => void;
    readonly shutdown: () => Promise<void>;
}

interface PendingPluginExecute extends NodePluginRpcExecution {
    readonly requestCancellation: (reason: string) => void;
    readonly acknowledgeCancellation: () => void;
    readonly resolve: (result: NodeRunResult) => void;
    readonly reject: (error: Error) => void;
}

interface ManagedWorker {
    readonly worker: Worker;
    readonly fail: (failure: Error) => void;
    readonly terminate: () => Promise<void>;
}

function notifyDiagnostic(
    diagnostic: ((message: string) => void) | undefined,
    diagnosticEvent: ((event: EngineDiagnosticPayload) => void) | undefined,
    message: string,
    context: Omit<EngineDiagnosticPayload, 'message'> = {},
): void {
    try {
        diagnostic?.(message);
    } catch {
        // A diagnostic subscriber must not affect Plugin execution.
    }
    try {
        diagnosticEvent?.({ message, ...context });
    } catch {
        // A diagnostic subscriber must not affect Plugin execution.
    }
}

function pluginCancellationReason(signal: AbortSignal): string {
    const reason: unknown = signal.reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
    if (reason instanceof Error && reason.message.length > 0) return reason.message;
    return 'Plugin execution cancelled.';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function waitForWorkerLoad(
    worker: Worker,
): Promise<NodePluginWorkerLoaded | NodePluginWorkerLoadError> {
    return new Promise((resolve) => {
        let settled = false;
        let readinessTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
            if (readinessTimer !== undefined) {
                clearTimeout(readinessTimer);
                readinessTimer = undefined;
            }
            worker.off('message', onMessage);
            worker.off('error', onError);
            worker.off('exit', onExit);
        };

        const settle = (result: NodePluginWorkerLoaded | NodePluginWorkerLoadError): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const settleWithError = (error: string): void => {
            settle({ kind: NodePluginWorkerKind.LoadError, error });
        };

        const onMessage = (raw: unknown): void => {
            const parsed = NodePluginWorkerToMainSchema.safeParse(raw);
            if (!parsed.success) {
                settleWithError(`Invalid Plugin worker load message: ${parsed.error.message}`);
                return;
            }
            const msg = parsed.data;
            if (
                msg.kind === NodePluginWorkerKind.Loaded ||
                msg.kind === NodePluginWorkerKind.LoadError
            ) {
                settle(msg);
            }
        };

        const onError = (error: Error): void => {
            settleWithError(`Worker error before sending load result: ${error.message}`);
        };

        const onExit = (code: number): void => {
            settleWithError(`Worker exited with code ${code} before sending load result`);
        };

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        readinessTimer = setTimeout(() => {
            settleWithError(
                `Plugin worker did not become ready within ${PLUGIN_WORKER_READY_TIMEOUT_MS / 1000} seconds`,
            );
        }, PLUGIN_WORKER_READY_TIMEOUT_MS);
    });
}

export function createNodePluginWorkerSupervisor(
    options: NodePluginWorkerSupervisorOptions = {},
): NodePluginWorkerSupervisor {
    const workers = new Map<string, ManagedWorker>();
    const loadingPluginIds = new Set<string>();
    let isShuttingDown = false;
    let shutdownPromise: Promise<void> | undefined;

    const forgetWorker = (pluginId: string, worker: Worker): void => {
        if (workers.get(pluginId)?.worker === worker) workers.delete(pluginId);
    };

    const loadWorker = async (
        preparation: NodePluginPreparation,
        deps: NodePluginWorkerLoadDependencies,
    ): Promise<NodePluginWorkerLoadResult> => {
        const worker = new Worker(preparation.workerScriptPath, {
            workerData: {
                pluginId: preparation.pluginId,
                manifestNodeType: preparation.manifestNodeType,
                ...(preparation.nodeContract === undefined
                    ? {}
                    : { nodeContract: preparation.nodeContract }),
                handlerPath: preparation.handlerPath,
                manifestPermissions: preparation.manifestPermissions,
                permissions: preparation.permissions,
            },
            eval: false,
        });

        const provisional: ManagedWorker = {
            worker,
            fail: () => {},
            terminate: async (): Promise<void> => {
                await worker.terminate().catch(() => undefined);
            },
        };
        workers.set(preparation.pluginId, provisional);

        const loaded = await waitForWorkerLoad(worker);
        if (isShuttingDown) {
            forgetWorker(preparation.pluginId, worker);
            await worker.terminate().catch(() => undefined);
            return {
                ok: false,
                kind: 'worker_error',
                error: 'Plugin worker supervisor is shut down.',
            };
        }
        if (loaded.kind === NodePluginWorkerKind.LoadError) {
            forgetWorker(preparation.pluginId, worker);
            await worker.terminate().catch(() => undefined);
            return {
                ok: false,
                kind: 'worker_error',
                error: loaded.error,
                ...(loaded.contractError === undefined
                    ? {}
                    : { contractError: loaded.contractError }),
                ...(loaded.propertyError === undefined
                    ? {}
                    : { propertyError: loaded.propertyError }),
            };
        }

        const proxy = createWorkerNodeHandlerProxy(
            preparation.pluginId,
            worker,
            loaded.isTrigger,
            deps.kernel,
            deps.bridge,
            deps.diagnostic ?? options.diagnostic,
            deps.diagnosticEvent ?? options.diagnosticEvent,
            () => forgetWorker(preparation.pluginId, worker),
        );
        const managed: ManagedWorker = {
            worker,
            fail: proxy.fail,
            terminate: async (): Promise<void> => {
                await worker.terminate().catch(() => undefined);
            },
        };
        workers.set(preparation.pluginId, managed);

        return {
            ok: true,
            handler: proxy.handler,
            descriptorType: loaded.descriptorType,
            isTrigger: loaded.isTrigger,
            ...(loaded.contract === undefined ? {} : { contract: loaded.contract }),
            ...(loaded.propertyDescriptors === undefined
                ? {}
                : { propertyDescriptors: loaded.propertyDescriptors }),
        };
    };

    const load = async (
        preparation: NodePluginPreparation,
        deps: NodePluginWorkerLoadDependencies,
        loadOptions: NodePluginWorkerLoadOptions = {},
    ): Promise<NodePluginWorkerLoadResult> => {
        if (isShuttingDown) {
            return {
                ok: false,
                kind: 'worker_error',
                error: 'Plugin worker supervisor is shut down.',
            };
        }

        const { pluginId } = preparation;
        if (loadingPluginIds.has(pluginId)) {
            return {
                ok: false,
                kind: 'already_loaded',
                error: `Plugin worker "${pluginId}" is already loading.`,
            };
        }
        if (workers.has(pluginId) && !loadOptions.replaceExisting) {
            return {
                ok: false,
                kind: 'already_loaded',
                error: `Plugin worker "${pluginId}" is already loaded.`,
            };
        }

        loadingPluginIds.add(pluginId);
        try {
            if (workers.has(pluginId)) await disposePlugin(pluginId);
            if (isShuttingDown) {
                return {
                    ok: false,
                    kind: 'worker_error',
                    error: 'Plugin worker supervisor is shut down.',
                };
            }
            return await loadWorker(preparation, deps);
        } finally {
            loadingPluginIds.delete(pluginId);
        }
    };

    const disposePlugin = async (pluginId: string): Promise<void> => {
        const managed = workers.get(pluginId);
        if (!managed) return;
        managed.fail(new Error(`Plugin worker "${pluginId}" was disposed.`));
        await managed.terminate();
        forgetWorker(pluginId, managed.worker);
    };

    const updatePermissions = (
        pluginId: string,
        permissions: NodePluginPreparation['permissions'],
    ): void => {
        const managed = workers.get(pluginId);
        if (!managed) return;
        try {
            managed.worker.postMessage({
                kind: NodePluginWorkerKind.UpdatePermissions,
                permissions: [...permissions],
            });
        } catch {
            workers.delete(pluginId);
        }
    };

    const shutdown = (): Promise<void> => {
        if (shutdownPromise) return shutdownPromise;
        isShuttingDown = true;
        const managedWorkers = [...workers.values()];
        shutdownPromise = Promise.all(
            managedWorkers.map(async (managed): Promise<void> => {
                managed.fail(new Error('Plugin worker supervisor shut down.'));
                await managed.terminate();
            }),
        ).then(() => {
            workers.clear();
        });
        return shutdownPromise;
    };

    return { load, disposePlugin, updatePermissions, shutdown };
}

interface WorkerNodeHandlerProxy {
    readonly handler: NodeHandler;
    readonly fail: (failure: Error) => void;
}

function createWorkerNodeHandlerProxy(
    pluginId: string,
    worker: Worker,
    isTrigger: boolean,
    kernel: KernelDeps | undefined,
    bridge: Pick<Bridge, 'emit'> | undefined,
    diagnostic: ((message: string) => void) | undefined,
    diagnosticEvent: ((event: EngineDiagnosticPayload) => void) | undefined,
    forgetWorker: () => void,
): WorkerNodeHandlerProxy {
    const pendingExecutes = new Map<string, PendingPluginExecute>();
    const pendingActivates = new Map<string, { onEvent: (ctx: WorkflowContext) => void }>();
    const activeFileWatcherSubscriptions = new Set<string>();
    let workerFailure: Error | undefined;

    const publishDiagnostic = (message: string, kind = 'worker'): void => {
        notifyDiagnostic(diagnostic, diagnosticEvent, message, {
            kind,
            source: 'plugin',
            pluginId,
            outcome: 'failed',
        });
    };
    const publishUnregistrationFailure = (subscriberId: string, error: unknown): void => {
        publishDiagnostic(
            `[proxy] failed to unregister File Watcher subscriber "${subscriberId}": ${errorMessage(error)}`,
        );
    };
    const publishScopedDiagnostic = (
        executeRequestId: string | undefined,
        message: string,
        kind: string,
    ): void => {
        if (executeRequestId === undefined) return;
        const pending = pendingExecutes.get(executeRequestId);
        const bus = pending?.deps.bus;
        if (!bus) return;
        void Promise.resolve(
            bus.next({
                name: 'engine.diagnostic',
                payload: {
                    message,
                    kind,
                    source: 'plugin',
                    pluginId,
                    outcome: 'failed',
                },
            }),
        ).catch(() => undefined);
    };

    const failWorker = (failure: Error): void => {
        if (workerFailure) return;
        workerFailure = failure;
        forgetWorker();
        publishDiagnostic(`[proxy] ${failure.message}`);

        if (kernel) {
            for (const subscriberId of activeFileWatcherSubscriptions) {
                try {
                    const unregistration = kernel.fileWatcherManager.unregisterSubscriber(
                        subscriberId,
                        pluginId,
                    );
                    if (unregistration instanceof Promise) {
                        void unregistration.catch((error: unknown) => {
                            publishUnregistrationFailure(subscriberId, error);
                        });
                    }
                } catch (error) {
                    publishUnregistrationFailure(subscriberId, error);
                }
            }
        }
        activeFileWatcherSubscriptions.clear();

        const executions = [...pendingExecutes.entries()];
        for (const [requestId, pending] of executions) {
            publishScopedDiagnostic(requestId, `[proxy] ${failure.message}`, 'worker');
            pending.reject(failure);
        }
        pendingExecutes.clear();

        const activations = [...pendingActivates.values()];
        pendingActivates.clear();
        for (const pending of activations) {
            try {
                Option.getOrUndefined(getDeactivationHook(pending.onEvent))?.(failure.message);
            } catch (error) {
                publishDiagnostic(
                    `[proxy] failed to settle activation after Plugin worker failure: ${errorMessage(error)}`,
                );
            }
        }
    };

    const workerFailureFor = (detail: string): Error =>
        new Error(
            `Plugin worker "${pluginId}" stopped unexpectedly (${detail}). Retry the Workflow or restart the Plugin.`,
        );

    const rpcRouter = createNodePluginRpcRouter({
        pluginId,
        pendingExecutions: pendingExecutes,
        post: (message) => worker.postMessage(message),
        kernel,
        bridge,
        trackFileWatcherSubscription: (subscriberId) => {
            activeFileWatcherSubscriptions.add(subscriberId);
        },
        untrackFileWatcherSubscription: (subscriberId) => {
            activeFileWatcherSubscriptions.delete(subscriberId);
        },
        diagnostic: (message, executeRequestId) => {
            publishDiagnostic(message, 'authorization');
            publishScopedDiagnostic(executeRequestId, message, 'authorization');
        },
    });

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
                typeof raw === 'object' &&
                raw !== null &&
                !Array.isArray(raw) &&
                'operation' in raw &&
                typeof raw.operation === 'string'
                    ? ` operation "${raw.operation}"`
                    : '';
            const message =
                `[proxy] Plugin "${pluginId}" sent an invalid${operation} message: ` +
                parsed.error.message;
            publishDiagnostic(message);
            if (
                typeof raw === 'object' &&
                raw !== null &&
                !Array.isArray(raw) &&
                'requestId' in raw &&
                typeof raw.requestId === 'string'
            ) {
                try {
                    worker.postMessage({
                        kind: NodePluginWorkerKind.DepsRpcError,
                        requestId: raw.requestId,
                        error: message,
                    });
                } catch {
                    // The worker may have been retired after a non-cooperative cancellation.
                }
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
            case NodePluginWorkerKind.CancelAcknowledged: {
                const pending = pendingExecutes.get(runtimeMsg.requestId);
                if (!pending) break;
                pending.acknowledgeCancellation();
                break;
            }
            case NodePluginWorkerKind.ExecuteResult:
            case NodePluginWorkerKind.ExecuteError: {
                const pending = pendingExecutes.get(runtimeMsg.requestId);
                if (!pending?.isRunning()) break;
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
                        publishDiagnostic(`[proxy] ${runtimeMsg.error}`, 'authorization');
                    }
                    pending.reject(new Error(runtimeMsg.error));
                }
                break;
            }
            case NodePluginWorkerKind.ActivateError: {
                const pending = pendingActivates.get(runtimeMsg.requestId);
                if (!pending) break;
                pendingActivates.delete(runtimeMsg.requestId);
                publishDiagnostic(
                    `[proxy] activation error for Plugin "${pluginId}": ${runtimeMsg.error}`,
                );
                try {
                    Option.getOrUndefined(getDeactivationHook(pending.onEvent))?.(runtimeMsg.error);
                } catch (error) {
                    publishDiagnostic(
                        `[proxy] failed to settle activation after Plugin activation error: ${errorMessage(error)}`,
                    );
                }
                break;
            }
            case NodePluginWorkerKind.ActivateResult:
                break;
            case NodePluginWorkerKind.Diagnostic:
                publishDiagnostic(`[worker] ${runtimeMsg.message}`);
                break;
            case NodePluginWorkerKind.ActivateEvent: {
                const pending = pendingActivates.get(runtimeMsg.requestId);
                if (!pending) break;
                const parsedContext = WorkflowContextSchema.safeParse({
                    event: runtimeMsg.event,
                    payload: runtimeMsg.payload,
                    vars: runtimeMsg.vars ?? {},
                });
                if (!parsedContext.success) {
                    publishDiagnostic(
                        `[proxy] Plugin "${pluginId}" emitted an invalid workflow context: ${parsedContext.error.message}`,
                    );
                    break;
                }
                pending.onEvent(parsedContext.data);
                break;
            }
            case NodePluginWorkerKind.DepsRpc:
                rpcRouter.route(runtimeMsg);
                break;
            default:
                assertNever(runtimeMsg);
        }
    });

    const handler: NodeHandler = {
        async execute({ node, ctx }, deps): Promise<NodeRunResult> {
            if (workerFailure) throw workerFailure;
            if (deps.signal?.aborted) {
                throw new Error(pluginCancellationReason(deps.signal));
            }
            const requestId = randomUUID();
            return new Promise<NodeRunResult>((resolve, reject) => {
                let state: PluginExecutionState = createPluginExecutionState();
                let settled = false;
                const cancellationController = new AbortController();
                const executionDeps: NodeHandlerDeps = {
                    ...deps,
                    signal: cancellationController.signal,
                };
                let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
                let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
                let abortListener: (() => void) | undefined;

                const cleanup = (): void => {
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }
                    if (cancellationTimer !== undefined) {
                        clearTimeout(cancellationTimer);
                        cancellationTimer = undefined;
                    }
                    if (deps.signal && abortListener) {
                        deps.signal.removeEventListener('abort', abortListener);
                        abortListener = undefined;
                    }
                    if (!cancellationController.signal.aborted) {
                        cancellationController.abort('Plugin execution settled.');
                    }
                    pendingExecutes.delete(requestId);
                };

                const resolveOnce = (result: NodeRunResult): void => {
                    if (settled) return;
                    settled = true;
                    state = { kind: 'settled' };
                    cleanup();
                    resolve(result);
                };

                const rejectOnce = (error: Error): void => {
                    if (settled) return;
                    settled = true;
                    state = { kind: 'settled' };
                    cleanup();
                    reject(error);
                };

                const acknowledgeCancellation = (): void => {
                    const reason =
                        state.kind === 'cancellation-requested'
                            ? state.reason
                            : 'Plugin execution cancelled.';
                    const transition = transitionPluginExecution(state, {
                        kind: 'cancel-acknowledged',
                    });
                    if (!transition.accepted) return;
                    state = transition.state;
                    rejectOnce(new Error(reason));
                };

                const requestCancellation = (reason: string): void => {
                    const transition = transitionPluginExecution(state, {
                        kind: 'cancel-requested',
                        reason,
                    });
                    if (!transition.accepted) return;
                    state = transition.state;
                    if (!cancellationController.signal.aborted) {
                        cancellationController.abort(reason);
                    }
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }

                    try {
                        worker.postMessage({
                            kind: NodePluginWorkerKind.CancelRequest,
                            requestId,
                            reason,
                        });
                    } catch (error) {
                        const failure = workerFailureFor(
                            `could not accept cancellation for execution: ${errorMessage(error)}`,
                        );
                        failWorker(failure);
                        return;
                    }

                    cancellationTimer = setTimeout(() => {
                        if (settled || state.kind !== 'cancellation-requested') return;
                        failWorker(
                            workerFailureFor(
                                `did not acknowledge cancellation for execution "${requestId}" within ${PLUGIN_EXECUTION_CANCEL_GRACE_PERIOD_MS}ms`,
                            ),
                        );
                        void worker.terminate().catch(() => undefined);
                    }, PLUGIN_EXECUTION_CANCEL_GRACE_PERIOD_MS);
                };

                const pending: PendingPluginExecute = {
                    deps: executionDeps,
                    isRunning: () => !settled && state.kind === 'running',
                    requestCancellation,
                    acknowledgeCancellation,
                    resolve: (result) => {
                        const transition = transitionPluginExecution(state, {
                            kind: 'completed',
                        });
                        if (!transition.accepted) return;
                        state = transition.state;
                        resolveOnce(result);
                    },
                    reject: (error) => rejectOnce(error),
                };

                pendingExecutes.set(requestId, pending);
                timeoutTimer = setTimeout(() => {
                    requestCancellation(
                        `Execute request timed out after ${PLUGIN_EXECUTION_TIMEOUT_MS / 1000}s`,
                    );
                }, PLUGIN_EXECUTION_TIMEOUT_MS);

                if (deps.signal) {
                    const signal = deps.signal;
                    abortListener = (): void =>
                        requestCancellation(pluginCancellationReason(signal));
                    signal.addEventListener('abort', abortListener, { once: true });
                    if (signal.aborted) requestCancellation(pluginCancellationReason(signal));
                }

                if (state.kind !== 'running') {
                    rejectOnce(
                        new Error(
                            state.kind === 'cancellation-requested'
                                ? state.reason
                                : 'Plugin execution cancelled.',
                        ),
                    );
                    return;
                }

                try {
                    worker.postMessage({
                        kind: NodePluginWorkerKind.ExecuteRequest,
                        requestId,
                        nodeType: node.type,
                        nodeConfig: node.config,
                        ctx,
                        deps: {
                            collisionSuffixStyle: deps.collisionSuffixStyle,
                            fileManager: deps.fileManager,
                            properties: deps.properties,
                        },
                    });
                } catch (error) {
                    const failure = workerFailureFor(
                        `could not accept an execute request: ${errorMessage(error)}`,
                    );
                    pending.reject(failure);
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
                      } catch (error) {
                          pendingActivates.delete(requestId);
                          const failure = workerFailureFor(
                              `could not accept an activation request: ${errorMessage(error)}`,
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
                          } catch (error) {
                              failWorker(
                                  workerFailureFor(
                                      `could not accept a teardown request: ${errorMessage(error)}`,
                                  ),
                              );
                          }
                      };
                  },
              }
            : {}),
    };

    return { handler, fail: failWorker };
}

function assertNever(value: never): never {
    throw new Error(`Unhandled node plugin worker message: ${JSON.stringify(value)}`);
}
