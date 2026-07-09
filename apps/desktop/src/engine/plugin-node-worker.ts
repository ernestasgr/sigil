import { parentPort, workerData } from 'node:worker_threads';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { z } from 'zod';

import {
    NodePluginWorkerKind,
    NodePluginMainToWorkerSchema,
    type NodePluginWorkerToMain,
    type NodePluginWorkerExecuteRequest,
    type NodePluginWorkerCallbackInvoke,
    type NodePluginWorkerUpdatePermissions,
} from './plugin-node-rpc.js';
import type {
    NodeHandler,
    NodeRunResult,
    TriggerHandler,
    NodeHandlerDeps,
    KernelDeps,
    Sleep,
    ResolveTemplate,
    EvaluateCondition,
    MatchSwitchCase,
} from './node-handlers/types.js';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { Capability } from '@sigil/schema/manifest';
import type { EventBus } from './event-bus.js';

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
            args: args as unknown[],
        });
    });
}

let depsTeardown: (() => void) | undefined;

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

function createProxiedDeps(collisionSuffixStyle?: CollisionSuffixStyle): NodeHandlerDeps {
    const rpc =
        (method: string) =>
        (...args: unknown[]): Promise<unknown> =>
            depRpcCall(method, args);

    return {
        bus: { next: rpc('bus.next') as EventBus['next'] } as EventBus,
        sleep: rpc('sleep') as unknown as Sleep,
        resolveTemplate: rpc('resolveTemplate') as unknown as ResolveTemplate,
        evaluateCondition: rpc('evaluateCondition') as unknown as EvaluateCondition,
        matchSwitchCase: rpc('matchSwitchCase') as unknown as MatchSwitchCase,
        state: {
            get: rpc('state.get') as unknown as (key: string) => string | undefined,
            set: rpc('state.set') as unknown as (key: string, value: string) => void,
            flush: rpc('state.flush') as unknown as () => void,
        },
        capabilityBroker: {
            request: ({ capability }: { pluginId: string; capability: Capability }) =>
                permissions.has(capability)
                    ? { ok: true as const }
                    : { ok: false as const, error: { kind: 'denied' as const, capability } },
        },
        collisionSuffixStyle,
    };
}

// ─── Build proxied kernel (KernelDeps, for factory handlers) ─

function createProxiedKernel(): KernelDeps {
    return {
        fileWatcherManager: {
            registerSubscriber: (subscriber: unknown, callback: (...args: unknown[]) => void) => {
                if (!permissions.has('filesystem.read')) {
                    throw new Error('Permission denied: filesystem.read');
                }
                const promise = rpcWithCallback(
                    'fileWatcherManager.registerSubscriber',
                    [subscriber],
                    callback,
                );
                void promise;
            },
            unregisterSubscriber: (id: string) => {
                void depRpcCall('fileWatcherManager.unregisterSubscriber', [id]);
            },
        },
        capabilityBroker: {
            request: ({ capability }: { pluginId: string; capability: string }) =>
                permissions.has(capability)
                    ? { ok: true as const }
                    : { ok: false as const, error: { kind: 'denied' as const, capability } },
        },
    } as unknown as KernelDeps;
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
    const realFs = workerRequire('node:fs') as Record<string, unknown>;
    const allowed = new Set<string>();
    if (permissions.has('filesystem.read')) {
        FS_READ_FUNCTIONS.forEach((f) => allowed.add(f));
    }
    if (permissions.has('filesystem.write')) {
        FS_WRITE_FUNCTIONS.forEach((f) => allowed.add(f));
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
    const realNet = workerRequire('node:net') as Record<string, unknown>;
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
    const realCp = workerRequire('node:child_process') as Record<string, unknown>;
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
type AnyFn = (...args: unknown[]) => unknown;

function createLiveModuleProxy(getCurrent: () => Record<string, unknown>): Record<string, unknown> {
    return new Proxy({} as Record<string, unknown>, {
        get(_, prop) {
            if (prop === '__esModule') return true;
            if (prop === 'default') return getCurrent();
            const mod = getCurrent();
            if (prop in mod) {
                const val = (mod as Record<string, unknown>)[prop as string];
                return typeof val === 'function'
                    ? (...args: unknown[]) => (val as AnyFn)(...args)
                    : val;
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
    });
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

async function loadHandler(): Promise<{
    descriptor: { type: string; configSchema?: { safeParse: (v: unknown) => unknown } };
    handler: NodeHandler | ((kernel: KernelDeps) => NodeHandler);
}> {
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

    const ctx = vm.createContext({
        require: (id: string): unknown => {
            const mod = sandboxModules[id];
            if (mod) return mod;
            throw new Error(
                `Module "${id}" is not available in the plugin sandbox. ` +
                    `Check plugin manifest permissions (available: ${[...permissions].join(', ') || 'none'}).`,
            );
        },
        console,
    } as Record<string, unknown>);

    try {
        vm.runInContext(code, ctx, { timeout: 5000 });
    } catch (err) {
        const msg =
            err instanceof Error ? `${err.message}\n${err.stack?.substring(0, 2000)}` : String(err);
        throw new Error(`Plugin sandbox evaluation failed: ${msg}`, {
            cause: err instanceof Error ? err : undefined,
        });
    }

    const exports = (ctx as unknown as Record<string, unknown>).__plugin__ as
        | Record<string, unknown>
        | undefined;

    if (!exports || typeof exports.descriptor !== 'object' || exports.descriptor === null) {
        throw new Error('Plugin module must export a descriptor object');
    }
    if (
        typeof exports.handler !== 'function' &&
        (typeof exports.handler !== 'object' || exports.handler === null)
    ) {
        throw new Error('Plugin module must export a handler object or factory function');
    }

    return exports as {
        descriptor: { type: string; configSchema?: { safeParse: (v: unknown) => unknown } };
        handler: NodeHandler | ((kernel: KernelDeps) => NodeHandler);
    };
}

// ─── Load handler ─────────────────────────────────────────────

async function main(): Promise<void> {
    let mod: {
        descriptor: { type: string; configSchema?: { safeParse: (v: unknown) => unknown } };
        handler: NodeHandler | ((kernel: KernelDeps) => NodeHandler);
    };

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

    if (
        typeof mod.handler !== 'function' &&
        (typeof mod.handler !== 'object' ||
            mod.handler === null ||
            typeof (mod.handler as unknown as Record<string, unknown>).execute !== 'function')
    ) {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: 'Module must export { descriptor, handler } where descriptor has type/configSchema and handler has execute',
        });
        return;
    }

    if (!mod.descriptor || typeof mod.descriptor.configSchema?.safeParse !== 'function') {
        send({
            kind: NodePluginWorkerKind.LoadError,
            error: 'Descriptor must have a configSchema with a safeParse method',
        });
        return;
    }

    let rawHandler: NodeHandler;
    if (typeof mod.handler === 'function') {
        const kernel = createProxiedKernel();
        rawHandler = mod.handler(kernel);
    } else {
        rawHandler = mod.handler;
    }

    const isTrigger = typeof (rawHandler as TriggerHandler).activate === 'function';

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
                await handleExecute(msg as NodePluginWorkerExecuteRequest, rawHandler);
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
                handleCallbackInvoke(msg as NodePluginWorkerCallbackInvoke);
                break;
            }
            case NodePluginWorkerKind.Teardown: {
                depsTeardown?.();
                break;
            }
            case NodePluginWorkerKind.UpdatePermissions: {
                const update = msg as NodePluginWorkerUpdatePermissions;
                permissions.clear();
                for (const p of update.permissions) {
                    permissions.add(p);
                }
                rebuildPermissionGatedModules();
                break;
            }
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

        const node = { id: '', type: msg.nodeType, config: msg.nodeConfig } as const;
        const ctx = msg.ctx as WorkflowContext;
        const deps = createProxiedDeps(
            msg.deps?.collisionSuffixStyle as CollisionSuffixStyle | undefined,
        );
        const result = await handler.execute({ node, ctx } as never, deps);
        sendResult(result);
    } catch (err) {
        sendError(err instanceof Error ? err.message : String(err));
    }
}

async function handleActivate(
    msg: { requestId: string; config: unknown },
    handler: NodeHandler,
): Promise<void> {
    if (!('activate' in handler)) {
        send({
            kind: NodePluginWorkerKind.ActivateError,
            requestId: msg.requestId,
            error: 'Handler does not implement activate',
        });
        return;
    }

    try {
        const trigger = handler as TriggerHandler;
        const onEvent = (eventCtx: WorkflowContext): void => {
            send({
                kind: NodePluginWorkerKind.ActivateEvent,
                requestId: msg.requestId,
                event: eventCtx.event,
                payload: eventCtx.payload,
                vars: eventCtx.vars,
            });
        };

        depsTeardown = trigger.activate(msg.config, onEvent);
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
