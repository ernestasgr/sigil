import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { type Capability, CapabilitySchema } from '@sigil/schema/manifest';
import type { PluginPipelineNode } from '@sigil/schema/nodes';
import {
    type AnyPropertyDescriptor,
    PropertyApplyModeSchema,
    serializePropertyDescriptor,
} from '@sigil/schema/properties-file';
import { type WorkflowContext, WorkflowContextSchema } from '@sigil/schema/workflow-context';
import { Either, Option } from 'effect';
import { z } from 'zod';
import type { CapabilityResult } from './capability-broker.js';
import type { FileEventCallback, SubscriberRegistration } from './file-watcher-manager.js';
import { FileEventSchema } from './file-watcher-manager.js';
import type {
    KernelDeps,
    NodeHandler,
    NodeHandlerDeps,
    NodeRunResult,
} from './node-handlers/types.js';
import { isTriggerHandler } from './node-handlers/types.js';
import {
    createPluginExecutionState,
    type PluginExecutionState,
    transitionPluginExecution,
} from './plugin-execution-state.js';
import {
    type NodePluginDepsRpcArgs,
    type NodePluginDepsRpcOperation,
    type NodePluginDepsRpcRequest,
    type NodePluginDepsRpcResult,
    NodePluginMainToWorkerSchema,
    type NodePluginPropertyError,
    NodePluginStateGetResultSchema,
    NodePluginStateMutationResultSchema,
    type NodePluginWorkerCallbackInvoke,
    type NodePluginWorkerCancelRequest,
    type NodePluginWorkerExecuteRequest,
    NodePluginWorkerKind,
    type NodePluginWorkerToMain,
} from './plugin-node-rpc.js';
import {
    buildPermissionGatedModule,
    buildSandboxGlobalObject,
    buildUnconditionalSandboxModules,
    createPluginSandboxSurface,
    createSandboxGlobalObject,
    createSandboxRequire,
    getSandboxModuleNames,
    type PluginSandboxSurface,
    type SandboxModuleName,
} from './plugin-node-sandbox.js';

if (!parentPort) {
    throw new Error('plugin-node-worker must be spawned as a worker_thread');
}

const port = parentPort;

const WorkerDataSchema = z.object({
    pluginId: z.string().min(1),
    manifestNodeType: z.string().min(1),
    handlerPath: z.string().min(1),
    manifestPermissions: z.array(CapabilitySchema).default([]),
    permissions: z.array(CapabilitySchema).default([]),
});

const data = WorkerDataSchema.parse(workerData);
const permissions = new Set<Capability>(data.permissions);

let sandboxModules: Record<string, unknown> = {};

// Current (live) permission-gated modules — updated by rebuildPermissionGatedModules.
// sandboxModules stores Proxy objects that delegate to these, so esbuild's __toESM
// captures the Proxy (__esModule: true → returns Proxy directly) and property access
// goes through the Proxy's get trap=live reads.
let currentPermissionGatedModules: Partial<Record<SandboxModuleName, Record<string, unknown>>> = {};

// Create a require function for ESM context (needed for sandbox module building)
const workerRequire = createRequire(import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Callable = (...args: unknown[]) => unknown;

function isCallable(value: unknown): value is Callable {
    return typeof value === 'function';
}

function isZodSchema(value: unknown): value is z.ZodType {
    return isRecord(value) && isCallable(value.safeParse);
}

function createLiveFunctionProxy(getCurrent: () => unknown, name: string): Callable {
    const target = function (this: unknown, ...args: unknown[]): unknown {
        const current = getCurrent();
        if (!isCallable(current)) {
            throw new Error(`Permission denied: ${name}`);
        }
        return Reflect.apply(current, this, args);
    };

    return new Proxy(target, {
        apply(_, thisArg, args) {
            const current = getCurrent();
            if (!isCallable(current)) {
                throw new Error(`Permission denied: ${name}`);
            }
            return Reflect.apply(current, thisArg, args);
        },
        construct(_, args) {
            const current = getCurrent();
            if (!isCallable(current)) {
                throw new Error(`Permission denied: ${name}`);
            }
            return Reflect.construct(current, args);
        },
        get(_, prop, receiver) {
            if (prop === 'prototype') {
                const current = getCurrent();
                if (isCallable(current)) return current.prototype;
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

interface RawPluginDescriptor {
    readonly type: string;
    readonly configSchema: { readonly safeParse: (value: unknown) => unknown };
    readonly properties?: unknown;
    readonly propertyDescriptors?: unknown;
}

interface RawPluginModule {
    readonly descriptor: RawPluginDescriptor;
    readonly handler: unknown;
    readonly properties?: unknown;
}

function isRawPluginDescriptor(value: unknown): value is RawPluginDescriptor {
    return (
        isRecord(value) &&
        typeof value.type === 'string' &&
        isRecord(value.configSchema) &&
        isCallable(value.configSchema.safeParse)
    );
}

function isNodeHandler(value: unknown): value is NodeHandler {
    return isRecord(value) && isCallable(value.execute);
}

function collectDeclaredProperties(
    value: unknown,
    indexOffset: number,
):
    | { readonly ok: true; readonly values: readonly unknown[] }
    | { readonly ok: false; readonly error: NodePluginPropertyError } {
    if (value === undefined) return { ok: true, values: [] };
    if (isRecord(value) && 'key' in value) {
        return { ok: true, values: [value] };
    }
    if (!Array.isArray(value)) {
        return {
            ok: false,
            error: {
                kind: 'invalid',
                index: indexOffset,
                message: 'Plugin properties must be an array of property descriptors.',
            },
        };
    }
    return { ok: true, values: value };
}

function serializePluginProperties(mod: RawPluginModule):
    | {
          readonly ok: true;
          readonly descriptors: readonly ReturnType<typeof serializePropertyDescriptor>[];
      }
    | { readonly ok: false; readonly error: NodePluginPropertyError } {
    const propertySources = [
        mod.descriptor.properties,
        mod.descriptor.propertyDescriptors,
        mod.properties,
    ];
    const declared: unknown[] = [];
    for (const source of propertySources) {
        const result = collectDeclaredProperties(source, declared.length);
        if (!result.ok) {
            return result;
        }
        declared.push(...result.values);
    }

    const keys = new Set<string>();
    const descriptors: ReturnType<typeof serializePropertyDescriptor>[] = [];
    for (const [index, value] of declared.entries()) {
        if (
            !isRecord(value) ||
            typeof value.key !== 'string' ||
            value.key.length === 0 ||
            !isZodSchema(value.schema)
        ) {
            return {
                ok: false,
                error: {
                    kind: 'invalid',
                    index,
                    key: isRecord(value) && typeof value.key === 'string' ? value.key : undefined,
                    message: 'Plugin property descriptors require a key and Zod schema.',
                },
            };
        }
        const apply = PropertyApplyModeSchema.safeParse(value.apply);
        if (!apply.success) {
            return {
                ok: false,
                error: {
                    kind: 'invalid',
                    index,
                    key: value.key,
                    message:
                        'Plugin property descriptors require an apply mode of "hot" or "restart-required".',
                },
            };
        }
        if (keys.has(value.key)) {
            return {
                ok: false,
                error: {
                    kind: 'duplicate',
                    index,
                    key: value.key,
                    message: `Plugin declares property "${value.key}" more than once.`,
                },
            };
        }
        keys.add(value.key);

        try {
            const descriptor: AnyPropertyDescriptor = {
                key: value.key,
                schema: value.schema,
                fallback: value.fallback,
                apply: apply.data,
            };
            descriptors.push(serializePropertyDescriptor(descriptor));
        } catch (error) {
            return {
                ok: false,
                error: {
                    kind: 'invalid',
                    index,
                    key: value.key,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    return { ok: true, descriptors };
}

function assertNever(value: never): never {
    throw new Error(`Unhandled plugin worker message: ${JSON.stringify(value)}`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getModuleRecord(moduleName: string): Record<string, unknown> {
    const moduleValue: unknown = workerRequire(moduleName);
    if (!isRecord(moduleValue)) {
        throw new Error(`Module "${moduleName}" did not export an object`);
    }
    return moduleValue;
}

function send(msg: NodePluginWorkerToMain): void {
    port.postMessage(msg);
}

// ─── RPC for deps/kernel methods ─────────────────────────────

interface ActivePluginExecution {
    readonly requestId: string;
    readonly controller: AbortController;
    readonly dependencyRequestIds: Set<string>;
    state: PluginExecutionState;
}

const activeExecutions = new Map<string, ActivePluginExecution>();

interface PendingDependencyRpc {
    readonly operation: NodePluginDepsRpcOperation;
    readonly executeRequestId?: string;
    readonly resolve: (value: unknown) => void;
    readonly reject: (err: Error) => void;
    readonly signal?: AbortSignal;
    readonly onAbort?: () => void;
}

const depRpcPending = new Map<string, PendingDependencyRpc>();

function cancellationError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    if (reason instanceof Error) return reason;
    if (typeof reason === 'string' && reason.length > 0) return new Error(reason);
    return new Error('Plugin execution cancelled.');
}

function removePendingDependencyRpc(requestId: string): PendingDependencyRpc | undefined {
    const pending = depRpcPending.get(requestId);
    if (!pending) return undefined;
    depRpcPending.delete(requestId);
    if (pending.executeRequestId) {
        activeExecutions.get(pending.executeRequestId)?.dependencyRequestIds.delete(requestId);
    }
    if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
    }
    return pending;
}

function depRpcCall(
    request: NodePluginDepsRpcRequest,
    executeRequestId?: string,
    signal?: AbortSignal,
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(cancellationError(signal));
            return;
        }

        const execution = executeRequestId ? activeExecutions.get(executeRequestId) : undefined;
        if (executeRequestId && execution?.state.kind !== 'running') {
            reject(
                cancellationError(
                    execution?.controller.signal ?? signal ?? new AbortController().signal,
                ),
            );
            return;
        }

        const requestId = randomUUID();
        const onAbort = signal
            ? (): void => {
                  const pending = removePendingDependencyRpc(requestId);
                  if (pending) pending.reject(cancellationError(signal));
              }
            : undefined;
        depRpcPending.set(requestId, {
            operation: request.operation,
            executeRequestId,
            resolve,
            reject,
            signal,
            onAbort,
        });
        execution?.dependencyRequestIds.add(requestId);
        if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true });

        try {
            send({
                kind: NodePluginWorkerKind.DepsRpc,
                requestId,
                ...request,
                executeRequestId,
            });
        } catch (error) {
            const pending = removePendingDependencyRpc(requestId);
            pending?.reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

type DependencyRpcDecodeResult =
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: string };

function decodeDependencyRpcResult(
    operation: NodePluginDepsRpcOperation,
    message: NodePluginDepsRpcResult,
): DependencyRpcDecodeResult {
    switch (operation) {
        case 'state.get': {
            const parsed = NodePluginStateGetResultSchema.safeParse(message);
            if (!parsed.success) {
                return { ok: false, error: parsed.error.message };
            }
            return { ok: true, value: Option.fromNullable(parsed.data.value) };
        }
        case 'state.set':
        case 'state.flush': {
            const parsed = NodePluginStateMutationResultSchema.safeParse(message);
            return parsed.success
                ? { ok: true, value: undefined }
                : { ok: false, error: parsed.error.message };
        }
        default:
            return { ok: true, value: message.value };
    }
}

function rejectMalformedDependencyRpc(raw: unknown, error: string): void {
    if (!isRecord(raw) || typeof raw.requestId !== 'string') return;
    const pending = removePendingDependencyRpc(raw.requestId);
    if (!pending) return;
    pending.reject(new Error(`Invalid dependency RPC response: ${error}`));
}

/**
 * The worker-side dependency functions are adapters over an asynchronous
 * message transport. The type is reconstructed once at this seam so plugin
 * handlers keep the same dependency interface as in-process handlers.
 */
function remoteCall<TOperation extends NodePluginDepsRpcOperation, TResult>(
    operation: TOperation,
    executeRequestId: string,
): (...args: NodePluginDepsRpcArgs<TOperation>) => TResult {
    return (...args) => {
        // The generic operation/args correlation is represented by the exported
        // Zod-derived types; this assertion only bridges TypeScript's inability
        // to preserve that correlation through a generic union construction.
        const request = { operation, args } as NodePluginDepsRpcRequest;
        return depRpcCall(request, executeRequestId) as unknown as TResult;
    };
}

type PluginBusEvent = Parameters<NodeHandlerDeps['bus']['next']>[0];

interface PluginEventEmission {
    readonly eventName: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

function normalizePluginBusEvent(value: unknown): Either.Either<PluginEventEmission, string> {
    if (!isRecord(value)) {
        return Either.left('Invalid Plugin Event emission: expected an Event object');
    }

    const eventName = value.name;
    if (typeof eventName !== 'string' || eventName.length === 0) {
        return Either.left('Invalid Plugin Event emission: event name must be a non-empty string');
    }

    if (eventName === 'plugin.event') {
        return Either.left(
            'Invalid Plugin Event emission: the internal "plugin.event" envelope is Engine-owned',
        );
    }

    const payload = value.payload;
    if (!isRecord(payload)) {
        return Either.left('Invalid Plugin Event emission: payload must be an object');
    }

    return Either.right({ eventName, payload });
}

type ActivationTeardown = () => void | Promise<void>;

interface ActivationState {
    readonly requestId: string;
    readonly pendingRegistrations: Set<Promise<unknown>>;
    readonly pendingUnregistrations: Set<Promise<unknown>>;
    readonly registrationFailures: Error[];
    readonly unregistrationFailures: Set<string>;
    readonly registeredSubscriberIds: Set<string>;
    readonly activationSettled: Promise<void>;
    readonly settleActivation: () => void;
    teardown?: ActivationTeardown;
    cleanupPromise?: Promise<void>;
    cancelled: boolean;
}

const activationScope = new AsyncLocalStorage<ActivationState>();
const pendingActivationStates = new Map<string, ActivationState>();
const activationTeardowns = new Map<string, () => void>();

function createActivationState(requestId: string): ActivationState {
    let settleActivation = (): void => {};
    const activationSettled = new Promise<void>((resolve) => {
        settleActivation = resolve;
    });
    return {
        requestId,
        pendingRegistrations: new Set(),
        pendingUnregistrations: new Set(),
        registrationFailures: [],
        unregistrationFailures: new Set(),
        registeredSubscriberIds: new Set(),
        activationSettled,
        settleActivation,
        cancelled: false,
    };
}

const MAX_PLUGIN_DIAGNOSTIC_LENGTH = 512;
const MAX_UNREGISTRATION_DIAGNOSTICS = 32;

function boundedPluginDiagnostic(message: string): string {
    return message.length > MAX_PLUGIN_DIAGNOSTIC_LENGTH
        ? `${message.slice(0, MAX_PLUGIN_DIAGNOSTIC_LENGTH - 1)}…`
        : message;
}

function sendPluginDiagnostic(message: string): void {
    try {
        send({
            kind: NodePluginWorkerKind.Diagnostic,
            message: boundedPluginDiagnostic(message),
        });
    } catch {
        // The worker may have been retired while reporting the diagnostic.
    }
}

// ─── Callback registry (for registerSubscriber etc.) ─────────

const callbacks = new Map<string, (...args: unknown[]) => void>();
const fileWatcherCallbackIds = new Map<string, string>();
let nextCallbackId = 1;

function removeFileWatcherCallback(subscriberId: string, expectedCallbackId?: string): void {
    const callbackId = fileWatcherCallbackIds.get(subscriberId);
    if (!callbackId || (expectedCallbackId && callbackId !== expectedCallbackId)) return;
    callbacks.delete(callbackId);
    fileWatcherCallbackIds.delete(subscriberId);
}

function trackActivationRegistration(
    subscriberId: string,
    request: Promise<unknown>,
): Promise<unknown> {
    const activation = activationScope.getStore();
    if (!activation) return request;

    activation.pendingRegistrations.add(request);
    const tracked = request.then(
        () => activation.registeredSubscriberIds.add(subscriberId),
        (error: unknown) => activation.registrationFailures.push(new Error(errorMessage(error))),
    );
    void tracked.finally(() => {
        activation.pendingRegistrations.delete(request);
    });
    return request;
}

function registerFileWatcherSubscriber(
    subscriber: SubscriberRegistration,
    callback: (...args: unknown[]) => void,
): Promise<unknown> {
    removeFileWatcherCallback(subscriber.id);
    const callbackId = `cb:${data.pluginId}:${nextCallbackId++}`;
    callbacks.set(callbackId, callback);
    fileWatcherCallbackIds.set(subscriber.id, callbackId);
    const request = depRpcCall({
        operation: 'fileWatcherManager.registerSubscriber',
        args: [subscriber, callbackId],
    });
    void request.catch(() => {
        removeFileWatcherCallback(subscriber.id, callbackId);
    });
    return trackActivationRegistration(subscriber.id, request);
}

function unregisterFileWatcherSubscriber(subscriberId: string): Promise<unknown> {
    const callbackId = fileWatcherCallbackIds.get(subscriberId);
    const activation = activationScope.getStore();
    const request = depRpcCall({
        operation: 'fileWatcherManager.unregisterSubscriber',
        args: [subscriberId],
    });
    const removeCallback = (): void => {
        if (callbackId) removeFileWatcherCallback(subscriberId, callbackId);
        activation?.registeredSubscriberIds.delete(subscriberId);
    };
    if (activation) {
        activation.pendingUnregistrations.add(request);
        void request.then(
            () => activation.pendingUnregistrations.delete(request),
            () => activation.pendingUnregistrations.delete(request),
        );
    }
    void request.then(removeCallback, (error: unknown) => {
        removeCallback();
        const failureKey = `${subscriberId}:${errorMessage(error)}`;
        const diagnostic =
            `[plugin:${data.pluginId}] failed to unregister File Watcher subscriber ` +
            `"${subscriberId}": ${errorMessage(error)}`;
        if (!activation) {
            sendPluginDiagnostic(diagnostic);
            return;
        }
        if (
            activation.unregistrationFailures.has(failureKey) ||
            activation.unregistrationFailures.size >= MAX_UNREGISTRATION_DIAGNOSTICS
        ) {
            return;
        }
        activation.unregistrationFailures.add(failureKey);
        sendPluginDiagnostic(diagnostic);
    });
    return request;
}

async function settleActivationRegistrations(state: ActivationState): Promise<void> {
    await Promise.resolve();
    while (state.pendingRegistrations.size > 0) {
        await Promise.allSettled([...state.pendingRegistrations]);
        await Promise.resolve();
    }

    const failure = state.registrationFailures[0];
    if (failure) throw failure;
}

async function settleActivationUnregistrations(state: ActivationState): Promise<void> {
    await Promise.resolve();
    while (state.pendingUnregistrations.size > 0) {
        await Promise.allSettled([...state.pendingUnregistrations]);
        await Promise.resolve();
    }
}

async function cleanupActivation(state: ActivationState): Promise<void> {
    if (state.cleanupPromise) return state.cleanupPromise;

    state.cleanupPromise = (async (): Promise<void> => {
        try {
            await settleActivationRegistrations(state);
        } catch {
            // The activation error is reported by handleActivate; cleanup still runs.
        }

        if (state.teardown) {
            try {
                await activationScope.run(state, () => Promise.resolve(state.teardown?.()));
            } catch (error) {
                sendPluginDiagnostic(
                    `[plugin:${data.pluginId}] failed to tear down activation "${state.requestId}": ${errorMessage(error)}`,
                );
            }
        }

        await settleActivationUnregistrations(state);

        await activationScope.run(state, async () => {
            await Promise.all(
                [...state.registeredSubscriberIds].map((subscriberId) =>
                    unregisterFileWatcherSubscriber(subscriberId).catch(() => undefined),
                ),
            );
        });
    })();

    return state.cleanupPromise;
}

// ─── Build proxied deps (NodeHandlerDeps) ───────────────────

function createProxiedDeps(
    execution: ActivePluginExecution,
    collisionSuffixStyle: NodeHandlerDeps['collisionSuffixStyle'] = undefined,
    fileManager: NodeHandlerDeps['fileManager'] = undefined,
    properties: NodeHandlerDeps['properties'] = undefined,
): NodeHandlerDeps {
    const executeRequestId = execution.requestId;
    const emit = remoteCall<'event.emit', Promise<void>>('event.emit', executeRequestId);
    const sleep: NodeHandlerDeps['sleep'] = (ms, signal = execution.controller.signal) =>
        depRpcCall({ operation: 'sleep', args: [ms] }, executeRequestId, signal) as Promise<void>;
    const next: NodeHandlerDeps['bus']['next'] = (value: PluginBusEvent) => {
        const emission = normalizePluginBusEvent(value);
        if (Either.isLeft(emission)) {
            // Send an intentionally invalid event.emit envelope so the main-side
            // receive site records the Plugin identity and rejects the request
            // before it can reach the Bridge or Event Bus.
            void emit('', {}).catch(() => undefined);
            throw new Error(
                `[plugin:${data.pluginId}] denied operation "event.emit": ${emission.left}`,
            );
        }
        return emit(emission.right.eventName, emission.right.payload);
    };

    return {
        bus: {
            next,
        },
        event: { emit },
        signal: execution.controller.signal,
        sleep,
        resolveTemplate: remoteCall<
            'resolveTemplate',
            ReturnType<NodeHandlerDeps['resolveTemplate']>
        >('resolveTemplate', executeRequestId),
        evaluateCondition: remoteCall<
            'evaluateCondition',
            ReturnType<NodeHandlerDeps['evaluateCondition']>
        >('evaluateCondition', executeRequestId),
        matchSwitchCase: remoteCall<
            'matchSwitchCase',
            ReturnType<NodeHandlerDeps['matchSwitchCase']>
        >('matchSwitchCase', executeRequestId),
        state: {
            get: remoteCall<'state.get', ReturnType<NodeHandlerDeps['state']['get']>>(
                'state.get',
                executeRequestId,
            ),
            set: remoteCall<'state.set', ReturnType<NodeHandlerDeps['state']['set']>>(
                'state.set',
                executeRequestId,
            ),
            flush: remoteCall<'state.flush', ReturnType<NodeHandlerDeps['state']['flush']>>(
                'state.flush',
                executeRequestId,
            ),
        },
        capabilityBroker: {
            request: ({ capability }) =>
                permissions.has(capability)
                    ? Either.right(undefined)
                    : Either.left({ kind: 'denied' as const, capability }),
        },
        collisionSuffixStyle,
        fileManager,
        properties,
    };
}

// ─── Build proxied kernel (KernelDeps, for factory handlers) ─

function createProxiedKernel(): KernelDeps {
    const fileWatcherManager: KernelDeps['fileWatcherManager'] = {
        registerSubscriber: (subscriber: SubscriberRegistration, callback: FileEventCallback) => {
            if (!permissions.has('filesystem.read')) {
                throw new Error('Permission denied: filesystem.read');
            }
            const onCallback = (...args: unknown[]): void => {
                const parsedEvent = FileEventSchema.safeParse(args[0]);
                if (parsedEvent.success) {
                    callback(parsedEvent.data);
                }
            };
            const registration = registerFileWatcherSubscriber(subscriber, onCallback).then(
                () => undefined,
            );
            void registration.catch(() => undefined);
            return registration;
        },
        unregisterSubscriber: (id: string) => {
            return unregisterFileWatcherSubscriber(id).then(
                () => undefined,
                () => undefined,
            );
        },
    };
    const capabilityBroker: KernelDeps['capabilityBroker'] = {
        request: ({ capability }): CapabilityResult =>
            permissions.has(capability)
                ? Either.right(undefined)
                : Either.left({ kind: 'denied', capability }),
    };

    return { fileWatcherManager, capabilityBroker };
}

// ─── Permission-based sandbox module builder ────────────────

/**
 * Create a Proxy that delegates to a "current" module.
 * The proxy has __esModule=true so esbuild's __toESM helper returns the proxy
 * directly (not a spread copy), meaning every property access goes through the
 * get trap → always reads from the latest module.
 */
function createLiveModuleProxy(getCurrent: () => Record<string, unknown>): Record<string, unknown> {
    return new Proxy<Record<string, unknown>>(
        {},
        {
            get(_, prop, receiver) {
                if (typeof prop !== 'string') return undefined;
                if (prop === '__esModule') return true;
                if (prop === 'default') return receiver;
                const mod = getCurrent();
                if (prop in mod) {
                    const getCurrentValue = (): unknown => getCurrent()[prop];
                    const value = getCurrentValue();
                    if (isCallable(value)) {
                        return createLiveFunctionProxy(getCurrentValue, prop);
                    }
                    if (isRecord(value)) {
                        return createLiveModuleProxy(() => {
                            const currentValue = getCurrentValue();
                            return isRecord(currentValue) ? currentValue : {};
                        });
                    }
                    return value;
                }
                return undefined;
            },
            has(_, prop) {
                return prop in getCurrent();
            },
            ownKeys() {
                return Reflect.ownKeys(getCurrent());
            },
            getOwnPropertyDescriptor(_, prop) {
                return Object.getOwnPropertyDescriptor(getCurrent(), prop);
            },
        },
    );
}

function buildSandboxModules(surface: PluginSandboxSurface): void {
    sandboxModules = buildUnconditionalSandboxModules(surface, getModuleRecord);
    rebuildPermissionGatedModules();
    for (const moduleName of getSandboxModuleNames()) {
        sandboxModules[moduleName] = createLiveModuleProxy(
            () => currentPermissionGatedModules[moduleName] ?? {},
        );
    }
}

function rebuildPermissionGatedModules(): void {
    const rebuiltModules: Partial<Record<SandboxModuleName, Record<string, unknown>>> = {};
    for (const moduleName of getSandboxModuleNames()) {
        rebuiltModules[moduleName] = buildPermissionGatedModule(
            moduleName,
            permissions,
            getModuleRecord,
        );
    }
    currentPermissionGatedModules = rebuiltModules;
}

// ─── Load handler (always sandboxed) ─────────────────────────

async function loadHandler(): Promise<RawPluginModule> {
    const source = readFileSync(data.handlerPath, 'utf-8');

    let esbuild: typeof import('esbuild');
    try {
        esbuild = await import('esbuild');
    } catch {
        throw new Error('esbuild is required for plugin loading but is not available');
    }

    const localRequire = createRequire(import.meta.url);
    const handlerDir = dirname(data.handlerPath);

    const result = await esbuild.build({
        stdin: {
            contents: source,
            resolveDir: handlerDir,
            sourcefile: data.handlerPath,
            loader: 'ts',
        },
        bundle: true,
        format: 'iife',
        globalName: '__plugin__',
        platform: 'node',
        target: 'esnext',
        external: ['node:*'],
        plugins: [
            {
                name: 'resolve-deps',
                setup(build) {
                    build.onResolve({ filter: /^[^.\\/]/ }, (args) => {
                        if (args.path.startsWith('node:')) return;
                        try {
                            const resolved = localRequire.resolve(args.path, {
                                paths: [handlerDir],
                            });
                            return { path: resolved };
                        } catch {
                            try {
                                const resolved = localRequire.resolve(args.path);
                                return { path: resolved };
                            } catch {
                                return undefined;
                            }
                        }
                    });
                },
            },
        ],
        write: false,
    });

    const code = result.outputFiles[0].text;
    const sandboxGlobalObject = createSandboxGlobalObject();
    const sandboxRequire = createSandboxRequire(() => sandboxModules, permissions);
    const surface = createPluginSandboxSurface({
        globalObject: sandboxGlobalObject,
        resolveModule: sandboxRequire,
    });
    buildSandboxModules(surface);
    Object.assign(sandboxGlobalObject, buildSandboxGlobalObject(surface.globals));

    const ctx = vm.createContext(sandboxGlobalObject, {
        codeGeneration: surface.codeGeneration,
    });

    try {
        vm.runInContext(code, ctx, { timeout: 5000 });
    } catch (err) {
        const msg =
            err instanceof Error ? `${err.message}\n${err.stack?.substring(0, 2000)}` : String(err);
        throw new Error(`Plugin sandbox evaluation failed: ${msg}`, {
            cause: err,
        });
    }

    const pluginExports = isRecord(ctx) ? ctx.__plugin__ : undefined;
    if (!isRecord(pluginExports)) {
        throw new Error('Plugin module must export a descriptor object');
    }

    const descriptor = pluginExports.descriptor;
    if (!isRawPluginDescriptor(descriptor)) {
        throw new Error('Plugin module must export a descriptor object');
    }

    const handler = pluginExports.handler;
    if (!isNodeHandler(handler) && typeof handler !== 'function') {
        throw new Error('Plugin module must export a handler object or factory function');
    }

    return {
        descriptor,
        handler,
        ...(pluginExports.properties === undefined ? {} : { properties: pluginExports.properties }),
    };
}

// ─── Load handler ─────────────────────────────────────────────

async function main(): Promise<void> {
    let mod: RawPluginModule;

    try {
        mod = await loadHandler();
    } catch (err) {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: err instanceof Error ? err.message : String(err),
        });
        return;
    }

    const serializedProperties = serializePluginProperties(mod);
    if (!serializedProperties.ok) {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: serializedProperties.error.message,
            propertyError: serializedProperties.error,
        });
        return;
    }

    const descriptorType = mod.descriptor?.type ?? '';

    if (descriptorType !== data.manifestNodeType) {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: `Descriptor type "${descriptorType}" does not match manifest nodeType "${data.manifestNodeType}"`,
        });
        return;
    }

    if (!isNodeHandler(mod.handler) && typeof mod.handler !== 'function') {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: 'Module must export { descriptor, handler } where descriptor has type/configSchema and handler has execute',
        });
        return;
    }

    let rawHandler: NodeHandler;
    if (typeof mod.handler === 'function') {
        const kernel = createProxiedKernel();
        const handler = mod.handler(kernel);
        if (!isNodeHandler(handler)) {
            send({
                kind: NodePluginWorkerKind.LoadError,
                error: 'Handler factory did not return an object with an execute method',
            });
            return;
        }
        rawHandler = handler;
    } else {
        rawHandler = mod.handler;
    }

    const isTrigger = isTriggerHandler(rawHandler);

    send({
        kind: NodePluginWorkerKind.Loaded,
        descriptorType,
        isTrigger,
        ...(serializedProperties.descriptors.length === 0
            ? {}
            : { propertyDescriptors: serializedProperties.descriptors }),
    });

    // ─── Handle incoming messages ─────────────────────────

    port.on('message', async (raw: unknown) => {
        const parsed = NodePluginMainToWorkerSchema.safeParse(raw);
        if (!parsed.success) {
            rejectMalformedDependencyRpc(raw, parsed.error.message);
            console.warn(
                `[plugin-worker:${data.pluginId}] failed to parse incoming message:`,
                parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
                JSON.stringify(raw),
            );
            return;
        }
        const msg = parsed.data;

        switch (msg.kind) {
            case NodePluginWorkerKind.ExecuteRequest: {
                await handleExecute(msg, rawHandler);
                break;
            }
            case NodePluginWorkerKind.ActivateRequest: {
                await handleActivate(msg, rawHandler);
                break;
            }
            case NodePluginWorkerKind.CancelRequest: {
                cancelExecution(msg);
                break;
            }
            case NodePluginWorkerKind.DepsRpcResult:
            case NodePluginWorkerKind.DepsRpcError: {
                const pending = removePendingDependencyRpc(msg.requestId);
                if (!pending) break;
                if (msg.kind === NodePluginWorkerKind.DepsRpcResult) {
                    const decoded = decodeDependencyRpcResult(pending.operation, msg);
                    if (decoded.ok) {
                        pending.resolve(decoded.value);
                    } else {
                        pending.reject(
                            new Error(`Invalid dependency RPC response: ${decoded.error}`),
                        );
                    }
                } else {
                    pending.reject(new Error(msg.error));
                }
                break;
            }
            case NodePluginWorkerKind.CallbackInvoke: {
                handleCallbackInvoke(msg);
                break;
            }
            case NodePluginWorkerKind.Teardown: {
                const teardown = activationTeardowns.get(msg.requestId);
                if (teardown) {
                    activationTeardowns.delete(msg.requestId);
                    teardown();
                    break;
                }
                const pending = pendingActivationStates.get(msg.requestId);
                if (!pending) break;
                pending.cancelled = true;
                void pending.activationSettled
                    .then(() => cleanupActivation(pending))
                    .catch(() => undefined);
                break;
            }
            case NodePluginWorkerKind.UpdatePermissions: {
                permissions.clear();
                for (const p of msg.permissions) {
                    permissions.add(p);
                }
                rebuildPermissionGatedModules();
                break;
            }
            default:
                assertNever(msg);
        }
    });
}

function handleCallbackInvoke(msg: NodePluginWorkerCallbackInvoke): void {
    const cb = callbacks.get(msg.callbackId);
    if (!cb) return;
    cb(...msg.args);
}

function rejectExecutionDependencies(execution: ActivePluginExecution, error: Error): void {
    for (const requestId of [...execution.dependencyRequestIds]) {
        const pending = removePendingDependencyRpc(requestId);
        pending?.reject(error);
    }
}

function cancelExecution(msg: NodePluginWorkerCancelRequest): void {
    const execution = activeExecutions.get(msg.requestId);
    if (!execution) return;

    const reason = msg.reason ?? 'Plugin execution cancelled.';
    const transition = transitionPluginExecution(execution.state, {
        kind: 'cancel-requested',
        reason,
    });
    if (!transition.accepted) return;

    execution.state = transition.state;
    if (!execution.controller.signal.aborted) {
        execution.controller.abort(reason);
    }
    rejectExecutionDependencies(execution, cancellationError(execution.controller.signal));
}

async function handleExecute(
    msg: NodePluginWorkerExecuteRequest,
    handler: NodeHandler,
): Promise<void> {
    if (activeExecutions.has(msg.requestId)) {
        send({
            kind: NodePluginWorkerKind.ExecuteError,
            requestId: msg.requestId,
            error: `Duplicate Plugin execution request "${msg.requestId}"`,
        });
        return;
    }

    const execution: ActivePluginExecution = {
        requestId: msg.requestId,
        controller: new AbortController(),
        dependencyRequestIds: new Set(),
        state: createPluginExecutionState(),
    };
    activeExecutions.set(msg.requestId, execution);

    const sendResult = (result: NodeRunResult): void => {
        send({
            kind: NodePluginWorkerKind.ExecuteResult,
            requestId: msg.requestId,
            outputCtx: result.outputCtx,
            activePort: result.activePort,
        });
    };

    const sendError = (error: string): void => {
        send({
            kind: NodePluginWorkerKind.ExecuteError,
            requestId: msg.requestId,
            error,
        });
    };

    try {
        // Unbypassable permission check: verify all manifest-declared capabilities
        // are still granted before calling the handler.
        for (const cap of data.manifestPermissions) {
            if (!permissions.has(cap)) {
                sendError(`Permission denied: ${cap}`);
                execution.state = transitionPluginExecution(execution.state, {
                    kind: 'failed',
                }).state;
                return;
            }
        }

        const parsedContext = WorkflowContextSchema.safeParse(msg.ctx);
        if (!parsedContext.success) {
            sendError(`Invalid workflow context: ${parsedContext.error.message}`);
            execution.state = transitionPluginExecution(execution.state, {
                kind: 'failed',
            }).state;
            return;
        }

        const node: PluginPipelineNode = {
            id: '',
            type: msg.nodeType,
            pluginId: data.pluginId,
            config: msg.nodeConfig,
        };
        const deps = createProxiedDeps(
            execution,
            msg.deps?.collisionSuffixStyle,
            msg.deps?.fileManager,
            msg.deps?.properties,
        );
        const result = await handler.execute({ node, ctx: parsedContext.data }, deps);
        if (execution.state.kind !== 'running') return;
        sendResult(result);
        execution.state = transitionPluginExecution(execution.state, {
            kind: 'completed',
        }).state;
    } catch (err) {
        if (execution.state.kind === 'running') {
            sendError(err instanceof Error ? err.message : String(err));
            execution.state = transitionPluginExecution(execution.state, {
                kind: 'failed',
            }).state;
        }
    } finally {
        const wasCancelled = execution.state.kind === 'cancellation-requested';
        rejectExecutionDependencies(
            execution,
            wasCancelled
                ? cancellationError(execution.controller.signal)
                : new Error('Plugin execution finished before its dependency RPC settled.'),
        );
        activeExecutions.delete(msg.requestId);

        if (wasCancelled) {
            execution.state = transitionPluginExecution(execution.state, {
                kind: 'cancel-acknowledged',
            }).state;
            send({
                kind: NodePluginWorkerKind.CancelAcknowledged,
                requestId: msg.requestId,
            });
        }
    }
}

async function handleActivate(
    msg: { requestId: string; config: unknown },
    handler: NodeHandler,
): Promise<void> {
    if (!isTriggerHandler(handler)) {
        send({
            kind: NodePluginWorkerKind.ActivateError,
            requestId: msg.requestId,
            error: 'Handler does not implement activate',
        });
        return;
    }

    if (pendingActivationStates.has(msg.requestId) || activationTeardowns.has(msg.requestId)) {
        send({
            kind: NodePluginWorkerKind.ActivateError,
            requestId: msg.requestId,
            error: `Duplicate Plugin activation request "${msg.requestId}"`,
        });
        return;
    }

    const state = createActivationState(msg.requestId);
    pendingActivationStates.set(msg.requestId, state);

    try {
        const onEvent = (eventCtx: WorkflowContext): void => {
            send({
                kind: NodePluginWorkerKind.ActivateEvent,
                requestId: msg.requestId,
                event: eventCtx.event,
                payload: eventCtx.payload,
                vars: eventCtx.vars,
            });
        };

        const activationResult: unknown = await activationScope.run(state, () =>
            Promise.resolve(handler.activate(msg.config, onEvent)),
        );
        if (!isActivationTeardown(activationResult)) {
            throw new Error('Plugin activate must return a teardown function');
        }
        state.teardown = activationResult;
        await settleActivationRegistrations(state);

        if (state.cancelled) {
            await cleanupActivation(state);
            return;
        }

        activationTeardowns.set(msg.requestId, () => {
            void cleanupActivation(state).catch(() => undefined);
        });
        send({
            kind: NodePluginWorkerKind.ActivateResult,
            requestId: msg.requestId,
        });
    } catch (err) {
        try {
            await settleActivationRegistrations(state);
        } catch {
            // The original activation failure is the one sent to the main thread.
        }
        await cleanupActivation(state);
        if (!state.cancelled) {
            send({
                kind: NodePluginWorkerKind.ActivateError,
                requestId: msg.requestId,
                error: errorMessage(err),
            });
        }
    } finally {
        pendingActivationStates.delete(msg.requestId);
        state.settleActivation();
    }
}

function isActivationTeardown(value: unknown): value is ActivationTeardown {
    return typeof value === 'function';
}

void main();
