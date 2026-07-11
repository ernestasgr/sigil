import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { type Capability, CapabilitySchema } from '@sigil/schema/manifest';
import type { PluginPipelineNode } from '@sigil/schema/nodes';
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
    type NodePluginDepsRpcArgs,
    type NodePluginDepsRpcOperation,
    type NodePluginDepsRpcRequest,
    NodePluginMainToWorkerSchema,
    type NodePluginWorkerCallbackInvoke,
    type NodePluginWorkerExecuteRequest,
    NodePluginWorkerKind,
    type NodePluginWorkerToMain,
} from './plugin-node-rpc.js';
import {
    buildPermissionGatedModule,
    getSandboxModuleNames,
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
    return typeof value === 'object' && value !== null;
}

type Callable = (...args: unknown[]) => unknown;

function isCallable(value: unknown): value is Callable {
    return typeof value === 'function';
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
}

interface RawPluginModule {
    readonly descriptor: RawPluginDescriptor;
    readonly handler: unknown;
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

function assertNever(value: never): never {
    throw new Error(`Unhandled plugin worker message: ${JSON.stringify(value)}`);
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

const depRpcPending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function depRpcCall(
    request: NodePluginDepsRpcRequest,
    executeRequestId?: string,
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const requestId = randomUUID();
        depRpcPending.set(requestId, { resolve, reject });
        send({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId,
            ...request,
            executeRequestId,
        });
    });
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

let depsTeardown: Option.Option<() => void> = Option.none();

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
    return request;
}

function unregisterFileWatcherSubscriber(subscriberId: string): Promise<unknown> {
    const callbackId = fileWatcherCallbackIds.get(subscriberId);
    const request = depRpcCall({
        operation: 'fileWatcherManager.unregisterSubscriber',
        args: [subscriberId],
    });
    const removeCallback = (): void => {
        if (callbackId) removeFileWatcherCallback(subscriberId, callbackId);
    };
    void request.then(removeCallback, removeCallback);
    return request;
}

// ─── Build proxied deps (NodeHandlerDeps) ───────────────────

function createProxiedDeps(
    executeRequestId: string,
    collisionSuffixStyle: NodeHandlerDeps['collisionSuffixStyle'] = undefined,
): NodeHandlerDeps {
    return {
        bus: {
            next: remoteCall<'bus.next', ReturnType<NodeHandlerDeps['bus']['next']>>(
                'bus.next',
                executeRequestId,
            ),
        },
        sleep: remoteCall<'sleep', ReturnType<NodeHandlerDeps['sleep']>>('sleep', executeRequestId),
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
            void registerFileWatcherSubscriber(subscriber, onCallback).catch(() => undefined);
        },
        unregisterSubscriber: (id: string) => {
            void unregisterFileWatcherSubscriber(id).catch(() => undefined);
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

function buildSandboxModules(): void {
    sandboxModules = {};

    sandboxModules['node:path'] = workerRequire('node:path');
    sandboxModules['node:url'] = workerRequire('node:url');
    sandboxModules['node:crypto'] = { randomUUID: () => randomUUID() };

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
    buildSandboxModules();

    const vmContext: Record<string, unknown> = {
        require: (id: string): unknown => {
            const mod = sandboxModules[id];
            if (mod) return mod;
            throw new Error(
                `Module "${id}" is not available in the plugin sandbox. ` +
                    `Check plugin manifest permissions (available: ${[...permissions].join(', ') || 'none'}).`,
            );
        },
        console,
        process: { env: {} },
        global: undefined,
        globalThis: undefined,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        structuredClone,
        btoa,
        atob,
    };
    vmContext.global = vmContext;
    vmContext.globalThis = vmContext;

    const ctx = vm.createContext(vmContext);

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

    return { descriptor, handler };
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
    });

    // ─── Handle incoming messages ─────────────────────────

    port.on('message', async (raw: unknown) => {
        const parsed = NodePluginMainToWorkerSchema.safeParse(raw);
        if (!parsed.success) {
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
            case NodePluginWorkerKind.DepsRpcResult:
            case NodePluginWorkerKind.DepsRpcError: {
                const pending = depRpcPending.get(msg.requestId);
                if (!pending) break;
                depRpcPending.delete(msg.requestId);
                if (msg.kind === NodePluginWorkerKind.DepsRpcResult) {
                    pending.resolve(msg.value);
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
                Option.getOrUndefined(depsTeardown)?.();
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

async function handleExecute(
    msg: NodePluginWorkerExecuteRequest,
    handler: NodeHandler,
): Promise<void> {
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
                return;
            }
        }

        const parsedContext = WorkflowContextSchema.safeParse(msg.ctx);
        if (!parsedContext.success) {
            sendError(`Invalid workflow context: ${parsedContext.error.message}`);
            return;
        }

        const node: PluginPipelineNode = {
            id: '',
            type: msg.nodeType,
            pluginId: data.pluginId,
            config: msg.nodeConfig,
        };
        const deps = createProxiedDeps(msg.requestId, msg.deps?.collisionSuffixStyle);
        const result = await handler.execute({ node, ctx: parsedContext.data }, deps);
        sendResult(result);
    } catch (err) {
        sendError(err instanceof Error ? err.message : String(err));
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

        depsTeardown = Option.some(handler.activate(msg.config, onEvent));
        send({
            kind: NodePluginWorkerKind.ActivateResult,
            requestId: msg.requestId,
        });
    } catch (err) {
        send({
            kind: NodePluginWorkerKind.ActivateError,
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

void main();
