import type { Capability } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';

import type { Bridge } from './bridge.js';
import { FileEventSchema } from './file-watcher-manager.js';
import type { KernelDeps, NodeHandlerDeps } from './node-handlers/types.js';
import {
    type NodePluginDepsRpc,
    NodePluginDepsRpcSchema,
    NodePluginStateGetResultSchema,
    NodePluginStateMutationResultSchema,
    NodePluginWorkerKind,
} from './plugin-node-rpc.js';

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

export type NodePluginPrivilegedOperation =
    | NodePluginStateRpc['operation']
    | NodePluginFileWatcherRpc['operation'];

/** The single exhaustive mapping from privileged RPC operation to capability. */
export const NODE_PLUGIN_OPERATION_CAPABILITIES = {
    'state.get': 'state.read',
    'state.set': 'state.write',
    'state.flush': 'state.write',
    'fileWatcherManager.registerSubscriber': 'filesystem.read',
    'fileWatcherManager.unregisterSubscriber': 'filesystem.read',
} as const satisfies Readonly<Record<NodePluginPrivilegedOperation, Capability>>;

export interface NodePluginRpcExecution {
    readonly deps: NodeHandlerDeps;
    readonly isRunning: () => boolean;
}

export interface NodePluginRpcRouterOptions {
    readonly pluginId: string;
    readonly pendingExecutions: ReadonlyMap<string, NodePluginRpcExecution>;
    readonly post: (message: unknown) => void;
    readonly kernel?: KernelDeps;
    readonly bridge?: Pick<Bridge, 'emit'>;
    readonly trackFileWatcherSubscription: (subscriberId: string) => void;
    readonly untrackFileWatcherSubscription: (subscriberId: string) => void;
    readonly diagnostic?: (message: string, executeRequestId?: string) => void;
}

export interface NodePluginRpcRouter {
    /** Parse and route one worker-originated dependency RPC. */
    readonly route: (raw: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
    throw new Error(`Unhandled node plugin RPC: ${JSON.stringify(value)}`);
}

function postDepsRpcResult(
    post: (message: unknown) => void,
    requestId: string,
    value: unknown,
): void {
    try {
        post({
            kind: NodePluginWorkerKind.DepsRpcResult,
            requestId,
            value,
        });
    } catch {
        // The worker may have been retired after a non-cooperative cancellation.
    }
}

function postDepsRpcError(
    post: (message: unknown) => void,
    requestId: string,
    error: string,
): void {
    try {
        post({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId,
            error,
        });
    } catch {
        // The worker may have been retired after a non-cooperative cancellation.
    }
}

function postDepsRpcValue(
    post: (message: unknown) => void,
    requestId: string,
    value: unknown,
): void {
    if (value instanceof Promise) {
        void value
            .then((resolved) => {
                postDepsRpcResult(post, requestId, resolved);
            })
            .catch((error: unknown) => {
                postDepsRpcError(post, requestId, errorMessage(error));
            });
        return;
    }
    postDepsRpcResult(post, requestId, value);
}

function postWorkflowStateRpcValue(
    post: (message: unknown) => void,
    requestId: string,
    operation: NodePluginStateRpc['operation'],
    value: unknown,
): void {
    if (operation === 'state.get') {
        if (!Option.isOption(value)) {
            postDepsRpcError(post, requestId, 'Workflow State get must return an Option value');
            return;
        }

        const parsed = NodePluginStateGetResultSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpcResult,
            requestId,
            value: Option.getOrUndefined(value),
        });
        if (!parsed.success) {
            postDepsRpcError(
                post,
                requestId,
                `Invalid Workflow State get result: ${parsed.error.message}`,
            );
            return;
        }
        postDepsRpcResult(post, requestId, parsed.data.value);
        return;
    }

    const parsed = NodePluginStateMutationResultSchema.safeParse({
        kind: NodePluginWorkerKind.DepsRpcResult,
        requestId,
        value,
    });
    if (!parsed.success) {
        postDepsRpcError(
            post,
            requestId,
            `Invalid Workflow State mutation result: ${parsed.error.message}`,
        );
        return;
    }
    postDepsRpcResult(post, requestId, parsed.data.value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function denyPluginOperation(
    options: NodePluginRpcRouterOptions,
    requestId: string,
    operation: string,
    reason: string,
    executeRequestId?: string,
): void {
    const message = `[plugin:${options.pluginId}] denied operation "${operation}": ${reason}`;
    options.diagnostic?.(message, executeRequestId);
    postDepsRpcError(
        options.post,
        requestId,
        `Permission denied: ${reason} (operation "${operation}")`,
    );
}

function callNodeHandlerDepsMethod(
    deps: NodeHandlerDeps,
    msg: NodePluginHandlerDepsRpc,
    signal?: AbortSignal,
): unknown {
    switch (msg.operation) {
        case 'sleep':
            return deps.sleep(msg.args[0], signal);
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

function handleNodeHandlerDepsRpc(
    msg: NodePluginHandlerDepsRpc,
    options: NodePluginRpcRouterOptions,
): void {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        postDepsRpcError(
            options.post,
            msg.requestId,
            'No originating execute request for this dependency RPC',
        );
        return;
    }

    const pending = options.pendingExecutions.get(executeRequestId);
    if (!pending) {
        postDepsRpcError(
            options.post,
            msg.requestId,
            'No pending execute for this execute request',
        );
        return;
    }
    if (!pending.isRunning()) {
        postDepsRpcError(options.post, msg.requestId, 'Plugin execution cancellation requested');
        return;
    }

    try {
        const value = callNodeHandlerDepsMethod(pending.deps, msg, pending.deps.signal);
        postDepsRpcValue(options.post, msg.requestId, value);
    } catch (error) {
        postDepsRpcError(options.post, msg.requestId, errorMessage(error));
    }
}

async function handleEventEmitRpc(
    msg: NodePluginEventRpc,
    options: NodePluginRpcRouterOptions,
): Promise<void> {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            'No originating execute request',
            executeRequestId,
        );
        return;
    }

    const pending = options.pendingExecutions.get(executeRequestId);
    if (!pending) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            'No pending execute request',
            executeRequestId,
        );
        return;
    }
    if (!pending.isRunning()) {
        postDepsRpcError(options.post, msg.requestId, 'Plugin execution cancellation requested');
        return;
    }
    if (!options.bridge) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            'Bridge dependency is unavailable',
            executeRequestId,
        );
        return;
    }

    try {
        const [eventName, payload] = msg.args;
        const result = await options.bridge.emit(
            options.pluginId,
            { eventName, payload },
            pending.deps.bus,
        );
        if (!pending.isRunning()) {
            postDepsRpcError(
                options.post,
                msg.requestId,
                'Plugin execution cancellation requested',
            );
            return;
        }
        if (Either.isLeft(result)) {
            const reason =
                result.left.kind === 'sink_failed'
                    ? `${result.left.kind} for event "${eventName}": ${result.left.error}`
                    : `${result.left.kind} for event "${eventName}"`;
            denyPluginOperation(options, msg.requestId, msg.operation, reason, executeRequestId);
            return;
        }
        postDepsRpcResult(options.post, msg.requestId, undefined);
    } catch (error) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            errorMessage(error),
            executeRequestId,
        );
    }
}

function authorizePluginOperation(
    options: NodePluginRpcRouterOptions,
    operation: NodePluginPrivilegedOperation,
): ReturnType<KernelDeps['capabilityBroker']['request']> {
    if (!options.kernel) {
        return Either.left({
            kind: 'denied',
            capability: NODE_PLUGIN_OPERATION_CAPABILITIES[operation],
        });
    }
    return options.kernel.capabilityBroker.request({
        pluginId: options.pluginId,
        capability: NODE_PLUGIN_OPERATION_CAPABILITIES[operation],
    });
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

function handleStateRpc(msg: NodePluginStateRpc, options: NodePluginRpcRouterOptions): void {
    const executeRequestId = msg.executeRequestId;
    if (!executeRequestId) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            'No originating execute request',
            executeRequestId,
        );
        return;
    }

    const pending = options.pendingExecutions.get(executeRequestId);
    if (!pending) {
        denyPluginOperation(
            options,
            msg.requestId,
            msg.operation,
            'No pending execute request',
            executeRequestId,
        );
        return;
    }
    if (!pending.isRunning()) {
        postDepsRpcError(options.post, msg.requestId, 'Plugin execution cancellation requested');
        return;
    }

    try {
        const permission = authorizePluginOperation(options, msg.operation);
        if (Either.isLeft(permission)) {
            denyPluginOperation(
                options,
                msg.requestId,
                msg.operation,
                permission.left.capability,
                executeRequestId,
            );
            return;
        }

        const value = callWorkflowStateMethod(pending.deps.state, msg);
        postWorkflowStateRpcValue(options.post, msg.requestId, msg.operation, value);
    } catch (error) {
        postDepsRpcError(options.post, msg.requestId, errorMessage(error));
    }
}

function handleFileWatcherRpc(
    msg: NodePluginFileWatcherRpc,
    options: NodePluginRpcRouterOptions,
): void {
    if (!options.kernel) {
        postDepsRpcError(
            options.post,
            msg.requestId,
            `Kernel dependency is unavailable for "${msg.operation}"`,
        );
        return;
    }

    try {
        const permission = authorizePluginOperation(options, msg.operation);
        if (Either.isLeft(permission)) {
            denyPluginOperation(
                options,
                msg.requestId,
                msg.operation,
                permission.left.capability,
                msg.executeRequestId,
            );
            return;
        }

        switch (msg.operation) {
            case 'fileWatcherManager.registerSubscriber': {
                const [subscriber, callbackId] = msg.args;
                options.kernel.fileWatcherManager.registerSubscriber(subscriber, (fileEvent) => {
                    const parsedEvent = FileEventSchema.safeParse(fileEvent);
                    if (!parsedEvent.success) return;
                    try {
                        options.post({
                            kind: NodePluginWorkerKind.CallbackInvoke,
                            callbackId,
                            args: [parsedEvent.data],
                        });
                    } catch {
                        // The worker may have been retired after a non-cooperative cancellation.
                    }
                });
                options.trackFileWatcherSubscription(subscriber.id);
                postDepsRpcResult(options.post, msg.requestId, undefined);
                return;
            }
            case 'fileWatcherManager.unregisterSubscriber': {
                const [id] = msg.args;
                options.kernel.fileWatcherManager.unregisterSubscriber(id);
                options.untrackFileWatcherSubscription(id);
                postDepsRpcResult(options.post, msg.requestId, undefined);
                return;
            }
            default:
                assertNever(msg);
        }
    } catch (error) {
        postDepsRpcError(options.post, msg.requestId, errorMessage(error));
    }
}

function handleCapabilityRpc(
    msg: NodePluginCapabilityRpc,
    options: NodePluginRpcRouterOptions,
): void {
    if (!options.kernel) {
        postDepsRpcError(
            options.post,
            msg.requestId,
            'Capability Broker dependency is unavailable',
        );
        return;
    }

    try {
        const capability = msg.args[0];
        const result = options.kernel.capabilityBroker.request({
            pluginId: options.pluginId,
            capability,
        });
        if (Either.isLeft(result)) {
            options.diagnostic?.(
                `[plugin:${options.pluginId}] denied operation "${msg.operation}": ${result.left.capability}`,
            );
        }
        const value = Either.isRight(result)
            ? { ok: true as const }
            : { ok: false as const, error: result.left };
        postDepsRpcResult(options.post, msg.requestId, value);
    } catch (error) {
        postDepsRpcError(options.post, msg.requestId, errorMessage(error));
    }
}

function routeParsedRpc(msg: NodePluginDepsRpc, options: NodePluginRpcRouterOptions): void {
    switch (msg.operation) {
        case 'event.emit':
            void handleEventEmitRpc(msg, options);
            return;
        case 'fileWatcherManager.registerSubscriber':
        case 'fileWatcherManager.unregisterSubscriber':
            handleFileWatcherRpc(msg, options);
            return;
        case 'capabilityBroker.request':
            handleCapabilityRpc(msg, options);
            return;
        case 'state.get':
        case 'state.set':
        case 'state.flush':
            handleStateRpc(msg, options);
            return;
        case 'sleep':
        case 'resolveTemplate':
        case 'evaluateCondition':
        case 'matchSwitchCase':
            handleNodeHandlerDepsRpc(msg, options);
            return;
        default:
            assertNever(msg);
    }
}

export function createNodePluginRpcRouter(
    options: NodePluginRpcRouterOptions,
): NodePluginRpcRouter {
    return {
        route: (raw: unknown): void => {
            const parsed = NodePluginDepsRpcSchema.safeParse(raw);
            if (!parsed.success) {
                if (isRecord(raw) && typeof raw.requestId === 'string') {
                    postDepsRpcError(
                        options.post,
                        raw.requestId,
                        `Invalid Plugin RPC request: ${parsed.error.message}`,
                    );
                }
                options.diagnostic?.(
                    `[plugin:${options.pluginId}] invalid dependency RPC: ${parsed.error.message}`,
                );
                return;
            }
            routeParsedRpc(parsed.data, options);
        },
    };
}
