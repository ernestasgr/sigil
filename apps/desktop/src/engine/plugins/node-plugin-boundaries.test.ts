import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { Either, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEngine } from './engine.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { isTriggerHandler, type KernelDeps } from './node-handlers/types.js';
import { discoverNodePlugin, discoverNodePlugins } from './node-plugin-discovery.js';
import { createNodePluginLoader, type NodePluginLoader } from './node-plugin-loader.js';
import { prepareNodePlugin } from './node-plugin-preparation.js';
import {
    createNodePluginRpcRouter,
    NODE_PLUGIN_OPERATION_CAPABILITIES,
} from './node-plugin-rpc-router.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import { NodePluginWorkerKind } from './plugin-node-rpc.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

const HANDLER = `
import { z } from 'zod';

export const descriptor = {
    type: 'isolated-boundary-node',
    configSchema: z.object({}),
    defaultConfig: {},
    getOutputPorts: () => ['out'],
};

export const handler = {
    async execute({ ctx }) {
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const TRIGGER_HANDLER = `
import { z } from 'zod';

export const descriptor = {
    type: 'isolated-boundary-trigger',
    configSchema: z.object({}),
    defaultConfig: {},
    getOutputPorts: () => ['out'],
};

export function handler(kernel) {
    return {
        activate(_config, _onEvent) {
            kernel.fileWatcherManager.registerSubscriber(
                {
                    id: 'boundary-trigger',
                    path: '/boundary',
                    recursive: false,
                    events: ['file.created'],
                },
                () => {},
            );
            return () => {
                kernel.fileWatcherManager.unregisterSubscriber('boundary-trigger');
            };
        },
        async execute({ ctx }) {
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

function writePlugin(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'plugin.manifest.json'),
        JSON.stringify({
            id: 'com.sigil.boundary',
            version: '0.0.1',
            permissions: ['filesystem.read'],
            emits: ['boundary.output'],
            nodeType: 'isolated-boundary-node',
        }),
    );
    writeFileSync(join(dir, 'handler.ts'), HANDLER);
}

function writeTriggerPlugin(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'plugin.manifest.json'),
        JSON.stringify({
            id: 'com.sigil.boundary-trigger',
            version: '0.0.1',
            permissions: ['filesystem.read'],
            emits: ['boundary.output'],
            nodeType: 'isolated-boundary-trigger',
        }),
    );
    writeFileSync(join(dir, 'handler.ts'), TRIGGER_HANDLER);
}

const PARTIAL_REGISTRATION_FAILURE_HANDLER = `
import { z } from 'zod';

export const descriptor = {
    type: 'partial-registration-failure-trigger',
    configSchema: z.object({}),
    defaultConfig: {},
    getOutputPorts: () => ['out'],
};

export function handler(kernel) {
    return {
        activate(_config, _onEvent) {
            kernel.fileWatcherManager.registerSubscriber(
                {
                    id: 'successful-registration',
                    path: '/successful',
                    recursive: false,
                    events: ['file.created'],
                },
                () => {},
            );
            kernel.fileWatcherManager.registerSubscriber(
                {
                    id: 'failed-registration',
                    path: '/failed',
                    recursive: false,
                    events: ['file.created'],
                },
                () => {},
            );
            return () => kernel.fileWatcherManager.unregisterSubscriber('successful-registration');
        },
        async execute({ ctx }) {
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

function writePartialRegistrationFailurePlugin(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'plugin.manifest.json'),
        JSON.stringify({
            id: 'com.sigil.partial-registration-failure',
            version: '0.0.1',
            permissions: ['filesystem.read'],
            emits: ['boundary.output'],
            nodeType: 'partial-registration-failure-trigger',
        }),
    );
    writeFileSync(join(dir, 'handler.ts'), PARTIAL_REGISTRATION_FAILURE_HANDLER);
}

const CONCURRENT_ACTIVATION_HANDLER = `
import { z } from 'zod';

export const descriptor = {
    type: 'concurrent-activation-trigger',
    configSchema: z.object({ id: z.string() }),
    defaultConfig: { id: 'default' },
    getOutputPorts: () => ['out'],
};

export function handler(kernel) {
    return {
        activate(config, _onEvent) {
            kernel.fileWatcherManager.registerSubscriber(
                {
                    id: config.id,
                    path: '/' + config.id,
                    recursive: false,
                    events: ['file.created'],
                },
                () => {},
            );
            return () => kernel.fileWatcherManager.unregisterSubscriber(config.id);
        },
        async execute({ ctx }) {
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

function writeConcurrentActivationPlugin(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'plugin.manifest.json'),
        JSON.stringify({
            id: 'com.sigil.concurrent-activation',
            version: '0.0.1',
            permissions: ['filesystem.read'],
            emits: ['boundary.output'],
            nodeType: 'concurrent-activation-trigger',
        }),
    );
    writeFileSync(join(dir, 'handler.ts'), CONCURRENT_ACTIVATION_HANDLER);
}

function createKernel(capability: KernelDeps['capabilityBroker']['request']): KernelDeps {
    return {
        capabilityBroker: { request: capability },
        fileWatcherManager: {
            registerSubscriber: vi.fn(),
            unregisterSubscriber: vi.fn(),
        },
    };
}

describe('Plugin discovery and preparation seams', () => {
    let tempDir: string;

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('discovers declarations without registry or worker effects', () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-discovery-'));
        const pluginDir = join(tempDir, 'plugin');
        writePlugin(pluginDir);

        const result = discoverNodePlugin(pluginDir);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.plugin.manifest.id).toBe('com.sigil.boundary');
            expect(result.plugin.handlerPath).toBe(join(pluginDir, 'handler.ts'));
        }
        expect(discoverNodePlugins(tempDir)).toHaveLength(1);
    });

    it('prepares immutable worker input without registering or starting anything', () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-preparation-'));
        const pluginDir = join(tempDir, 'plugin');
        writePlugin(pluginDir);
        const discovered = discoverNodePlugin(pluginDir);

        expect(discovered.ok).toBe(true);
        if (!discovered.ok) return;

        const preparation = prepareNodePlugin(discovered.plugin, {
            workerScriptPath: 'worker.js',
            permissions: [],
        });

        expect(preparation).toMatchObject({
            pluginId: 'com.sigil.boundary',
            manifestNodeType: 'isolated-boundary-node',
            workerScriptPath: 'worker.js',
            permissions: [],
        });
        expect(preparation.manifestPermissions).toEqual(['filesystem.read']);
        expect(preparation.permissions).not.toBe(discovered.plugin.manifest.permissions);
    });
});

describe('typed Plugin RPC authorization router', () => {
    it('keeps one exhaustive capability mapping for privileged operations', () => {
        expect(NODE_PLUGIN_OPERATION_CAPABILITIES).toEqual({
            'state.get': 'state.read',
            'state.set': 'state.write',
            'state.flush': 'state.write',
            'fileWatcherManager.registerSubscriber': 'filesystem.read',
            'fileWatcherManager.unregisterSubscriber': 'filesystem.read',
        });
    });

    it('parses, authorizes, and responds to a Workflow State read in one route', () => {
        const post = vi.fn();
        const request = vi.fn(() => Either.right(undefined));
        const get = vi.fn(() => Option.some('value'));
        const pendingExecutions = new Map([
            [
                'execute:1',
                {
                    deps: { state: { get } } as never,
                    isRunning: () => true,
                },
            ],
        ]);
        const router = createNodePluginRpcRouter({
            pluginId: 'com.sigil.boundary',
            pendingExecutions,
            post,
            kernel: createKernel(request),
            trackFileWatcherSubscription: vi.fn(),
            untrackFileWatcherSubscription: vi.fn(),
        });

        router.route({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'rpc:1',
            executeRequestId: 'execute:1',
            operation: 'state.get',
            args: ['key'],
        });

        expect(request).toHaveBeenCalledWith({
            pluginId: 'com.sigil.boundary',
            capability: 'state.read',
        });
        expect(get).toHaveBeenCalledWith('key');
        expect(post).toHaveBeenCalledWith({
            kind: NodePluginWorkerKind.DepsRpcResult,
            requestId: 'rpc:1',
            value: 'value',
        });
    });

    it('rejects malformed or unauthorized RPCs before touching the adapter', () => {
        const post = vi.fn();
        const request: KernelDeps['capabilityBroker']['request'] = vi.fn(() =>
            Either.left({ kind: 'denied' as const, capability: 'state.read' as const }),
        );
        const get = vi.fn(() => Option.some('should-not-run'));
        const router = createNodePluginRpcRouter({
            pluginId: 'com.sigil.boundary',
            pendingExecutions: new Map([
                [
                    'execute:1',
                    {
                        deps: { state: { get } } as never,
                        isRunning: () => true,
                    },
                ],
            ]),
            post,
            kernel: createKernel(request),
            trackFileWatcherSubscription: vi.fn(),
            untrackFileWatcherSubscription: vi.fn(),
        });

        router.route({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'rpc:denied',
            executeRequestId: 'execute:1',
            operation: 'state.get',
            args: ['key'],
        });
        router.route({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'rpc:malformed',
            operation: 'state.get',
            args: [42],
        });

        expect(get).not.toHaveBeenCalled();
        expect(post).toHaveBeenNthCalledWith(1, {
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: 'rpc:denied',
            error: 'Permission denied: state.read (operation "state.get")',
        });
        expect(post).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                kind: NodePluginWorkerKind.DepsRpcError,
                requestId: 'rpc:malformed',
            }),
        );
    });
});

describe('instance-owned Plugin loader supervision', () => {
    let tempDir: string;
    let loaders: NodePluginLoader[] = [];

    afterEach(async () => {
        await Promise.all(loaders.map((loader) => loader.shutdown()));
        loaders = [];
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('does not let one loader permission update affect another loader instance', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-isolation-'));
        const pluginDir = join(tempDir, 'plugin');
        writePlugin(pluginDir);
        const first = createNodePluginLoader();
        const second = createNodePluginLoader();
        loaders = [first, second];

        const firstRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const secondRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const firstResult = await first.loadNodePlugin(pluginDir, {
            manifestRegistry: createManifestRegistry(),
            handlerRegistry: firstRegistry,
        });
        const secondResult = await second.loadNodePlugin(pluginDir, {
            manifestRegistry: createManifestRegistry(),
            handlerRegistry: secondRegistry,
        });

        expect(firstResult.ok).toBe(true);
        expect(secondResult.ok).toBe(true);
        if (!firstResult.ok || !secondResult.ok) return;

        const input = {
            node: {
                id: 'node',
                type: 'isolated-boundary-node',
                pluginId: 'com.sigil.boundary',
                config: {},
            },
            ctx: { event: '', payload: {}, vars: {} },
        };
        first.updatePluginPermissions('com.sigil.boundary', []);

        await expect(firstResult.handler.execute(input, {} as never)).rejects.toThrow(
            'Permission denied: filesystem.read',
        );
        await expect(secondResult.handler.execute(input, {} as never)).resolves.toMatchObject({
            activePort: 'out',
        });
    });

    it('does not orphan a worker when duplicate loads race within one loader', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-race-'));
        const pluginDir = join(tempDir, 'plugin');
        writePlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const deps = { manifestRegistry, handlerRegistry };

        const [firstResult, secondResult] = await Promise.all([
            loader.loadNodePlugin(pluginDir, deps),
            loader.loadNodePlugin(pluginDir, deps),
        ]);
        const results = [firstResult, secondResult];
        const successful = results.filter((result) => result.ok);
        const duplicate = results.filter(
            (result) => !result.ok && result.error.kind === 'duplicate',
        );

        expect(successful).toHaveLength(1);
        expect(duplicate).toHaveLength(1);
        if (successful.length !== 1 || !successful[0].ok) return;

        await loader.shutdown();
        await expect(
            successful[0].handler.execute(
                {
                    node: {
                        id: 'node',
                        type: 'isolated-boundary-node',
                        pluginId: 'com.sigil.boundary',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow(/supervisor shut down/i);
    });

    it('settles loaded workers when the owning loader shuts down', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-shutdown-'));
        const pluginDir = join(tempDir, 'plugin');
        writePlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry: createManifestRegistry(),
            handlerRegistry: createNodeHandlerRegistry(createBuiltinHandlers()),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        await loader.shutdown();

        await expect(
            result.handler.execute(
                {
                    node: {
                        id: 'node',
                        type: 'isolated-boundary-node',
                        pluginId: 'com.sigil.boundary',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow(/supervisor shut down/i);
    });

    it('settles watcher registration before teardown can unregister the subscription', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-activation-'));
        const pluginDir = join(tempDir, 'plugin');
        writeTriggerPlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        let resolveRegistration: () => void = () => {};
        const registration = new Promise<void>((resolve) => {
            resolveRegistration = resolve;
        });
        const registerSubscriber = vi.fn(() => registration);
        const unregisterSubscriber = vi.fn();
        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry: createManifestRegistry(),
            handlerRegistry: createNodeHandlerRegistry(createBuiltinHandlers()),
            kernel: {
                capabilityBroker: {
                    request: () => Either.right(undefined),
                },
                fileWatcherManager: { registerSubscriber, unregisterSubscriber },
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok || !isTriggerHandler(result.handler)) return;
        const teardown = result.handler.activate({}, () => {});
        await vi.waitFor(() => expect(registerSubscriber).toHaveBeenCalledTimes(1));
        teardown();
        teardown();
        expect(unregisterSubscriber).not.toHaveBeenCalled();
        resolveRegistration();
        await vi.waitFor(() => expect(unregisterSubscriber).toHaveBeenCalledTimes(1));
    });

    it('fails Workflow activation after a watcher registration failure and cleans up partial setup', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-activation-failure-'));
        const pluginDir = join(tempDir, 'plugin');
        writePartialRegistrationFailurePlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        const engine = createEngine({ defaultDatabasePath: join(tempDir, 'engine.db') });
        let activator: ReturnType<typeof createWorkflowActivator> | undefined;

        try {
            const registerSubscriber = vi.fn((subscriber: { readonly id: string }) => {
                if (subscriber.id === 'failed-registration') {
                    throw new Error('watcher registration failed');
                }
            });
            const unregisterSubscriber = vi.fn();
            const result = await loader.loadNodePlugin(pluginDir, {
                manifestRegistry: createManifestRegistry(),
                handlerRegistry: engine.handlerRegistry,
                kernel: {
                    capabilityBroker: {
                        request: () => Either.right(undefined),
                    },
                    fileWatcherManager: { registerSubscriber, unregisterSubscriber },
                },
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const store = createWorkflowStore(
                join(tempDir, 'workflows'),
                workflowTopologyOptions(engine.handlerRegistry),
            );
            const pipeline: CompiledPipeline = {
                id: 'pipeline-activation-failure',
                workflowId: 'workflow-activation-failure',
                schemaVersion: 1,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'partial-registration-failure-trigger',
                        pluginId: 'com.sigil.partial-registration-failure',
                        config: {},
                    },
                ],
                edges: [],
            };
            const workflow = store.create('Activation Failure Workflow', pipeline, {});
            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);

            expect(activator.activate(workflow.id)).toBe(true);
            await vi.waitFor(() => {
                expect(store.getSummary(workflow.id)).toMatchObject({
                    value: {
                        activation: { kind: 'failed', message: 'watcher registration failed' },
                    },
                });
            });

            expect(activator.isActive(workflow.id)).toBe(false);
            expect(registerSubscriber).toHaveBeenCalledTimes(2);
            expect(unregisterSubscriber).toHaveBeenCalledTimes(1);
            expect(unregisterSubscriber).toHaveBeenCalledWith('successful-registration');
        } finally {
            activator?.dispose();
            await engine.shutdown();
        }
    });

    it('keeps concurrent activation registration settlement isolated per request', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-concurrent-activation-'));
        const pluginDir = join(tempDir, 'plugin');
        writeConcurrentActivationPlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        const engine = createEngine({ defaultDatabasePath: join(tempDir, 'engine.db') });
        let activator: ReturnType<typeof createWorkflowActivator> | undefined;

        try {
            let rejectFirst: (error: Error) => void = () => {};
            let resolveSecond: () => void = () => {};
            const firstRegistration = new Promise<void>((_resolve, reject) => {
                rejectFirst = reject;
            });
            const secondRegistration = new Promise<void>((resolve) => {
                resolveSecond = resolve;
            });
            let registrationNumber = 0;
            const registerSubscriber = vi.fn(() => {
                registrationNumber += 1;
                return registrationNumber === 1 ? firstRegistration : secondRegistration;
            });
            const unregisterSubscriber = vi.fn();
            const result = await loader.loadNodePlugin(pluginDir, {
                manifestRegistry: createManifestRegistry(),
                handlerRegistry: engine.handlerRegistry,
                kernel: {
                    capabilityBroker: {
                        request: () => Either.right(undefined),
                    },
                    fileWatcherManager: { registerSubscriber, unregisterSubscriber },
                },
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const store = createWorkflowStore(
                join(tempDir, 'workflows'),
                workflowTopologyOptions(engine.handlerRegistry),
            );
            const createPipeline = (
                pipelineId: string,
                workflowId: string,
                id: string,
            ): CompiledPipeline => ({
                id: pipelineId,
                workflowId,
                schemaVersion: 1,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'concurrent-activation-trigger',
                        pluginId: 'com.sigil.concurrent-activation',
                        config: { id },
                    },
                ],
                edges: [],
            });
            const first = store.create(
                'First Concurrent Workflow',
                createPipeline('pipeline-first', 'workflow-first', 'first'),
                {},
            );
            const second = store.create(
                'Second Concurrent Workflow',
                createPipeline('pipeline-second', 'workflow-second', 'second'),
                {},
            );
            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);

            expect(activator.activate(first.id)).toBe(true);
            expect(activator.activate(second.id)).toBe(true);
            await vi.waitFor(() => expect(registerSubscriber).toHaveBeenCalledTimes(2));

            resolveSecond();
            await vi.waitFor(() => {
                expect(store.getSummary(second.id)).toMatchObject({
                    value: { activation: { kind: 'active' } },
                });
            });

            rejectFirst(new Error('first registration failed'));
            await vi.waitFor(() => {
                expect(store.getSummary(first.id)).toMatchObject({
                    value: { activation: { kind: 'failed', message: 'first registration failed' } },
                });
            });

            expect(activator.isActive(first.id)).toBe(false);
            expect(activator.isActive(second.id)).toBe(true);
            expect(unregisterSubscriber).toHaveBeenCalledWith('first');
        } finally {
            activator?.dispose();
            await engine.shutdown();
        }
    });

    it('reports watcher unregistration failures as one bounded Plugin diagnostic', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-loader-unregistration-failure-'));
        const pluginDir = join(tempDir, 'plugin');
        writeTriggerPlugin(pluginDir);
        const loader = createNodePluginLoader();
        loaders = [loader];
        const diagnostics: string[] = [];
        const registerSubscriber = vi.fn();

        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry: createManifestRegistry(),
            handlerRegistry: createNodeHandlerRegistry(createBuiltinHandlers()),
            kernel: {
                capabilityBroker: {
                    request: () => Either.right(undefined),
                },
                fileWatcherManager: {
                    registerSubscriber,
                    unregisterSubscriber: vi.fn(() =>
                        Promise.reject(new Error('watcher unregistration failed')),
                    ),
                },
            },
            diagnostic: (message) => diagnostics.push(message),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(isTriggerHandler(result.handler)).toBe(true);
        const handler = result.handler;
        if (!isTriggerHandler(handler)) return;

        const activateAndTeardown = async (): Promise<void> => {
            const expectedRegistrations = registerSubscriber.mock.calls.length + 1;
            const activationTeardown = handler.activate({}, () => {});
            await vi.waitFor(() =>
                expect(registerSubscriber).toHaveBeenCalledTimes(expectedRegistrations),
            );
            activationTeardown();
        };

        await activateAndTeardown();

        await vi.waitFor(() => {
            expect(
                diagnostics.filter((message) => message.includes('watcher unregistration failed')),
            ).toHaveLength(1);
        });

        await activateAndTeardown();

        await vi.waitFor(() => {
            expect(
                diagnostics.filter((message) => message.includes('watcher unregistration failed')),
            ).toHaveLength(2);
        });
    });
});
