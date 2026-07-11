import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
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
    NodePluginMainToWorkerSchema,
    type NodePluginWorkerCallbackInvoke,
    type NodePluginWorkerExecuteRequest,
    NodePluginWorkerKind,
    type NodePluginWorkerToMain,
} from './plugin-node-rpc.js';

if (!parentPort) {
    throw new Error('plugin-node-worker must be spawned as a worker_thread');
}

const port = parentPort;

const WorkerDataSchema = z.object({
    pluginId: z.string().min(1),
    manifestNodeType: z.string().min(1),
    handlerPath: z.string().min(1),
    manifestPermissions: z.array(z.string()).default([]),
    permissions: z.array(z.string()).default([]),
});

const data = WorkerDataSchema.parse(workerData);
const permissions = new Set(data.permissions);

let sandboxModules: Record<string, unknown> = {};

// Current (live) permission-gated modules — updated by rebuildPermissionGatedModules.
// sandboxModules stores Proxy objects that delegate to these, so esbuild's __toESM
// captures the Proxy (__esModule: true → returns Proxy directly) and property access
// goes through the Proxy's get trap=live reads.
let currentFsModule: Record<string, unknown> = {};
let currentNetModule: Record<string, unknown> = {};
let currentCpModule: Record<string, unknown> = {};

// Create a require function for ESM context (needed for sandbox module building)
const workerRequire = createRequire(import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

type Callable = (...args: unknown[]) => unknown;

function isCallable(value: unknown): value is Callable {
    return typeof value === 'function';
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

function depRpcCall(method: string, args: readonly unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const requestId = randomUUID();
        depRpcPending.set(requestId, { resolve, reject });
        send({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId,
            method,
            args: [...args],
        });
    });
}

/**
 * The worker-side dependency functions are adapters over an asynchronous
 * message transport. The type is reconstructed once at this seam so plugin
 * handlers keep the same dependency interface as in-process handlers.
 */
function remoteCall<Args extends readonly unknown[], Result>(
    method: string,
): (...args: Args) => Result {
    return (...args) => depRpcCall(method, args) as Result;
}

let depsTeardown: Option.Option<() => void> = Option.none();

// ─── Callback registry (for registerSubscriber etc.) ─────────

const callbacks = new Map<string, (...args: unknown[]) => void>();
let nextCallbackId = 1;

function rpcWithCallback(
    method: string,
    args: readonly unknown[],
    callback?: (...args: unknown[]) => void,
): Promise<unknown> {
    if (!callback) return depRpcCall(method, args);
    const callbackId = `cb:${data.pluginId}:${nextCallbackId++}`;
    callbacks.set(callbackId, callback);
    return depRpcCall(method, [...args, callbackId]);
}

// ─── Build proxied deps (NodeHandlerDeps) ───────────────────

function createProxiedDeps(
    collisionSuffixStyle: NodeHandlerDeps['collisionSuffixStyle'] = undefined,
): NodeHandlerDeps {
    return {
        bus: {
            next: remoteCall<
                Parameters<NodeHandlerDeps['bus']['next']>,
                ReturnType<NodeHandlerDeps['bus']['next']>
            >('bus.next'),
        },
        sleep: remoteCall<
            Parameters<NodeHandlerDeps['sleep']>,
            ReturnType<NodeHandlerDeps['sleep']>
        >('sleep'),
        resolveTemplate: remoteCall<
            Parameters<NodeHandlerDeps['resolveTemplate']>,
            ReturnType<NodeHandlerDeps['resolveTemplate']>
        >('resolveTemplate'),
        evaluateCondition: remoteCall<
            Parameters<NodeHandlerDeps['evaluateCondition']>,
            ReturnType<NodeHandlerDeps['evaluateCondition']>
        >('evaluateCondition'),
        matchSwitchCase: remoteCall<
            Parameters<NodeHandlerDeps['matchSwitchCase']>,
            ReturnType<NodeHandlerDeps['matchSwitchCase']>
        >('matchSwitchCase'),
        state: {
            get: remoteCall<
                Parameters<NodeHandlerDeps['state']['get']>,
                ReturnType<NodeHandlerDeps['state']['get']>
            >('state.get'),
            set: remoteCall<
                Parameters<NodeHandlerDeps['state']['set']>,
                ReturnType<NodeHandlerDeps['state']['set']>
            >('state.set'),
            flush: remoteCall<
                Parameters<NodeHandlerDeps['state']['flush']>,
                ReturnType<NodeHandlerDeps['state']['flush']>
            >('state.flush'),
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
            const promise = rpcWithCallback(
                'fileWatcherManager.registerSubscriber',
                [subscriber],
                onCallback,
            );
            void promise;
        },
        unregisterSubscriber: (id: string) => {
            void depRpcCall('fileWatcherManager.unregisterSubscriber', [id]);
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

const FS_READ_FUNCTIONS = [
    'readFileSync',
    'readFile',
    'readdirSync',
    'readdir',
    'existsSync',
    'statSync',
    'stat',
    'lstatSync',
    'lstat',
    'accessSync',
    'access',
    'realpathSync',
    'realpath',
    'openSync',
    'open',
    'closeSync',
    'close',
    'readSync',
    'read',
    'createReadStream',
    'ReadStream',
    'constants',
    'Dirent',
    'Stats',
];

const FS_WRITE_FUNCTIONS = [
    'writeFileSync',
    'writeFile',
    'mkdirSync',
    'mkdir',
    'renameSync',
    'rename',
    'copyFileSync',
    'copyFile',
    'unlinkSync',
    'unlink',
    'rmSync',
    'rm',
    'rmdirSync',
    'rmdir',
    'chmodSync',
    'chmod',
    'appendFileSync',
    'appendFile',
    'writeSync',
    'write',
    'createWriteStream',
    'WriteStream',
    'symlinkSync',
    'symlink',
    'linkSync',
    'link',
    'chownSync',
    'chown',
    'truncateSync',
    'truncate',
    'ftruncateSync',
    'ftruncate',
    'fchmodSync',
    'fchmod',
    'fchownSync',
    'fchown',
    'futimesSync',
    'futimes',
    'utimesSync',
    'utimes',
    'lutimesSync',
    'lutimes',
    'opendirSync',
    'opendir',
    'cpSync',
    'cp',
    'watch',
    'watchFile',
    'unwatchFile',
    'fsyncSync',
    'fsync',
    'fdatasyncSync',
    'fdatasync',
];

const NETWORK_FUNCTIONS = [
    'connect',
    'createConnection',
    'createServer',
    'isIP',
    'isIPv4',
    'isIPv6',
];

const PROCESSES_FUNCTIONS = [
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
    'spawn',
    'spawnSync',
];

function buildFsModule(): Record<string, unknown> {
    const realFs = getModuleRecord('node:fs');
    const allowed = new Set<string>();
    if (permissions.has('filesystem.read')) {
        for (const f of FS_READ_FUNCTIONS) allowed.add(f);
    }
    if (permissions.has('filesystem.write')) {
        for (const f of FS_WRITE_FUNCTIONS) allowed.add(f);
    }
    const allFs = new Set([...FS_READ_FUNCTIONS, ...FS_WRITE_FUNCTIONS]);
    const module: Record<string, unknown> = {};
    for (const key of allFs) {
        if (allowed.has(key) && key in realFs) {
            module[key] = realFs[key];
        } else {
            module[key] = (): never => {
                throw new Error(
                    `Permission denied: fs.${key} is not available. Grant 'filesystem.read' and/or 'filesystem.write' in the plugin manifest.`,
                );
            };
        }
    }
    return module;
}

function buildNetModule(): Record<string, unknown> {
    const realNet = getModuleRecord('node:net');
    const allowed = permissions.has('network');
    const module: Record<string, unknown> = {};
    for (const key of NETWORK_FUNCTIONS) {
        if (allowed && key in realNet) {
            module[key] = realNet[key];
        } else {
            module[key] = (): never => {
                throw new Error(
                    `Permission denied: net.${key} is not available. Grant 'network' in the plugin manifest.`,
                );
            };
        }
    }
    return module;
}

function buildChildProcessModule(): Record<string, unknown> {
    const realCp = getModuleRecord('node:child_process');
    const allowed = permissions.has('processes');
    const module: Record<string, unknown> = {};
    for (const key of PROCESSES_FUNCTIONS) {
        if (allowed && key in realCp) {
            module[key] = realCp[key];
        } else {
            module[key] = (): never => {
                throw new Error(
                    `Permission denied: child_process.${key} is not available. Grant 'processes' in the plugin manifest.`,
                );
            };
        }
    }
    return module;
}

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
            get(_, prop) {
                if (typeof prop !== 'string') return undefined;
                if (prop === '__esModule') return true;
                if (prop === 'default') return getCurrent();
                const mod = getCurrent();
                if (prop in mod) {
                    const val = mod[prop];
                    return isCallable(val) ? (...args: unknown[]) => val(...args) : val;
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

    currentFsModule = buildFsModule();
    currentNetModule = buildNetModule();
    currentCpModule = buildChildProcessModule();

    sandboxModules['node:fs'] = createLiveModuleProxy(() => currentFsModule);
    sandboxModules['node:net'] = createLiveModuleProxy(() => currentNetModule);
    sandboxModules['node:child_process'] = createLiveModuleProxy(() => currentCpModule);
}

function rebuildPermissionGatedModules(): void {
    currentFsModule = buildFsModule();
    currentNetModule = buildNetModule();
    currentCpModule = buildChildProcessModule();
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
        const deps = createProxiedDeps(msg.deps?.collisionSuffixStyle);
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
