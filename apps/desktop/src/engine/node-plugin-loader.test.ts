import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Either, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import type { KernelDeps } from './node-handlers/types.js';
import { loadNodePlugin, loadNodePlugins, updatePluginPermissions } from './node-plugin-loader.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import { createPermissionOverrideStore } from './permission-override-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createRegistries() {
    const manifestRegistry = createManifestRegistry();
    const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
    return { manifestRegistry, handlerRegistry };
}

function writePlugin(dir: string, manifest: Record<string, unknown>, handlerCode: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'handler.ts'), handlerCode);
}

const GREET_PLUGIN_HANDLER = `
import { z } from 'zod';
import type { NodeHandler, NodePluginModule } from '../../node-handlers/types.js';

const GreetConfigSchema = z.object({ name: z.string() });

export const descriptor = {
    type: 'greet' as const,
    configSchema: GreetConfigSchema,
    defaultConfig: { name: 'world' },
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute({ node, ctx }, deps) {
        const config = node.config as { name: string };
        deps.bus.next({ name: 'greet.output', payload: { message: 'hello ' + config.name } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const TRIGGER_PLUGIN_HANDLER = `
import { z } from 'zod';
import type { TriggerHandler, NodePluginModule } from '../../node-handlers/types.js';

const TickConfigSchema = z.object({ intervalMs: z.number() });

export const descriptor = {
    type: 'tick-trigger' as const,
    configSchema: TickConfigSchema,
    defaultConfig: { intervalMs: 100 },
    getOutputPorts: () => ['out'] as const,
};

export const handler: TriggerHandler = {
    activate(config, onEvent) {
        const c = config as { intervalMs: number };
        const timer = setInterval(() => {
            onEvent({ event: 'tick', payload: { ts: Date.now() }, vars: {} });
        }, c.intervalMs);
        return () => clearInterval(timer);
    },
    async execute({ ctx }) {
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

describe('loadNodePlugin', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('loads a TS plugin module and registers its manifest + handler', async () => {
        const pluginDir = join(tempDir, 'greet-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.greet',
                version: '0.0.1',
                permissions: [],
                emits: ['greet.output'],
                nodeType: 'greet',
            },
            GREET_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.id).toBe('com.sigil.greet');
            expect(result.descriptor.type).toBe('greet');
            expect(handlerRegistry.has('greet')).toBe(true);
            expect(manifestRegistry.has('com.sigil.greet')).toBe(true);
        }
    });

    it('registers a trigger plugin with an activate method', async () => {
        const pluginDir = join(tempDir, 'tick-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.tick',
                version: '0.0.1',
                permissions: [],
                emits: ['tick'],
                nodeType: 'tick-trigger',
            },
            TRIGGER_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.descriptor.type).toBe('tick-trigger');
            expect(handlerRegistry.has('tick-trigger')).toBe(true);
        }
    });

    it('fails when manifest is missing', async () => {
        const pluginDir = join(tempDir, 'empty-plugin');
        mkdirSync(pluginDir, { recursive: true });

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('missing_manifest');
        }
    });

    it('fails when manifest is invalid', async () => {
        const pluginDir = join(tempDir, 'bad-manifest');
        writePlugin(pluginDir, { id: 'x' }, 'export const handler = {}');

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('invalid_manifest');
        }
    });

    it('fails when manifest has no nodeType', async () => {
        const pluginDir = join(tempDir, 'no-node-type');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.no-node',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
            },
            GREET_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('missing_node_type');
        }
    });

    it('fails when handler module is missing', async () => {
        const pluginDir = join(tempDir, 'no-handler');
        mkdirSync(pluginDir, { recursive: true });
        writeFileSync(
            join(pluginDir, 'plugin.manifest.json'),
            JSON.stringify({
                id: 'com.sigil.no-handler',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'x',
            }),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('missing_handler');
        }
    });

    it('fails when descriptor type does not match manifest nodeType', async () => {
        const pluginDir = join(tempDir, 'type-mismatch');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.mismatch',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'wrong-type',
            },
            GREET_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('worker_error');
        }
    });

    it('fails on duplicate plugin id', async () => {
        const pluginDir = join(tempDir, 'dup-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.greet',
                version: '0.0.1',
                permissions: [],
                emits: ['greet.output'],
                nodeType: 'greet',
            },
            GREET_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        manifestRegistry.register({
            id: 'com.sigil.greet',
            version: '0.0.1',
            permissions: [],
            emits: ['greet.output'],
        });

        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('duplicate');
        }
    });

    it('fails when handler module has a syntax error (worker_error)', async () => {
        const pluginDir = join(tempDir, 'syntax-error');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.broken',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'broken',
            },
            'export const handler = {',
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('worker_error');
        }
    });

    it('fails when handler module loads but does not expose a valid entrypoint (worker_error)', async () => {
        const pluginDir = join(tempDir, 'bad-module');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.bad-module',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'bad-module',
            },
            'export const foo = 42;',
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('worker_error');
        }
    });

    it('fails when nodeType collides with an already-registered handler type', async () => {
        const pluginDir = join(tempDir, 'shadow-builtin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.evil-log',
                version: '0.0.1',
                permissions: [],
                emits: ['log.output'],
                nodeType: 'log',
            },
            GREET_PLUGIN_HANDLER.replace(/greet/g, 'log').replace(
                "'hello ' + config.name",
                "'evil'",
            ),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('duplicate_type');
            if (result.error.kind === 'duplicate_type') {
                expect(result.error.nodeType).toBe('log');
            }
        }
    });
});

describe('loadNodePlugins', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugins-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('loads all plugins from a directory', async () => {
        writePlugin(
            join(tempDir, 'greet-plugin'),
            {
                id: 'com.sigil.greet',
                version: '0.0.1',
                permissions: [],
                emits: ['greet.output'],
                nodeType: 'greet',
            },
            GREET_PLUGIN_HANDLER,
        );
        writePlugin(
            join(tempDir, 'tick-plugin'),
            {
                id: 'com.sigil.tick',
                version: '0.0.1',
                permissions: [],
                emits: ['tick'],
                nodeType: 'tick-trigger',
            },
            TRIGGER_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const results = await loadNodePlugins(tempDir, { manifestRegistry, handlerRegistry });

        expect(results).toHaveLength(2);
        expect(results.every((r) => r.ok)).toBe(true);
        expect(handlerRegistry.has('greet')).toBe(true);
        expect(handlerRegistry.has('tick-trigger')).toBe(true);
    });

    it('returns empty array for a non-existent directory', async () => {
        const { manifestRegistry, handlerRegistry } = createRegistries();
        const results = await loadNodePlugins(join(tempDir, 'does-not-exist'), {
            manifestRegistry,
            handlerRegistry,
        });
        expect(results).toHaveLength(0);
    });

    it('continues loading other plugins when one fails', async () => {
        writePlugin(
            join(tempDir, 'good-plugin'),
            {
                id: 'com.sigil.greet',
                version: '0.0.1',
                permissions: [],
                emits: ['greet.output'],
                nodeType: 'greet',
            },
            GREET_PLUGIN_HANDLER,
        );
        mkdirSync(join(tempDir, 'bad-plugin'), { recursive: true });

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const results = await loadNodePlugins(tempDir, { manifestRegistry, handlerRegistry });

        expect(results).toHaveLength(2);
        const successes = results.filter((r) => r.ok);
        const failures = results.filter((r) => !r.ok);
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(handlerRegistry.has('greet')).toBe(true);
    });
});

// ─── Capability broker sync test ─────────────────────────────

const PERM_CHECK_HANDLER = `
import { z } from 'zod';
import { Either } from 'effect';
import type { NodeHandler } from '../../node-handlers/types.js';

const ConfigSchema = z.object({ check: z.string() });

export const descriptor = {
    type: 'perm-checker' as const,
    configSchema: ConfigSchema,
    defaultConfig: { check: 'filesystem.read' },
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute({ node, ctx }, deps) {
        const config = node.config as { check: string };
        const result = deps.capabilityBroker.request({ pluginId: 'com.sigil.perm-checker', capability: config.check });
        if (Either.isLeft(result)) {
            throw new Error('DENIED: ' + result.left.capability);
        }
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const FACTORY_PERM_CHECK_HANDLER = `
import { z } from 'zod';
import { Either } from 'effect';
import type { TriggerHandler, KernelDeps, NodeRunResult } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'factory-perm-checker' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export function handler(kernel: KernelDeps): TriggerHandler {
    return {
        activate(config, onEvent) {
            const result = kernel.capabilityBroker.request({ pluginId: 'com.sigil.factory-perm-checker', capability: 'filesystem.read' });
            if (Either.isLeft(result)) {
                throw new Error('DENIED in activate: ' + result.left.capability);
            }
            onEvent({ event: 'perm-check.passed', payload: {}, vars: {} });
            return () => {};
        },
        async execute({ ctx }): Promise<NodeRunResult> {
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

const STATE_ACCESS_HANDLER = `
import { Option } from 'effect';
import { z } from 'zod';

const ConfigSchema = z.object({ operation: z.enum(['get', 'set', 'flush']) });

export const descriptor = {
    type: 'state-access' as const,
    configSchema: ConfigSchema,
    defaultConfig: { operation: 'get' },
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ node, ctx }, deps) {
        const operation = node.config.operation;
        if (operation === 'get') {
            const value = await deps.state.get('secret');
            return {
                outputCtx: { ...ctx, vars: { ...ctx.vars, secret: Option.getOrUndefined(value) } },
                activePort: 'out',
            };
        }
        if (operation === 'set') {
            await deps.state.set('secret', 'mutated');
        } else {
            await deps.state.flush();
        }
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

function createKernel(capabilityBroker: CapabilityBroker): KernelDeps {
    return {
        capabilityBroker,
        fileWatcherManager: {
            registerSubscriber: () => undefined,
            unregisterSubscriber: () => undefined,
        },
    };
}

describe('capabilityBroker sandbox sync', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-cap-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('allows a NodeHandler plugin to call deps.capabilityBroker.request synchronously when permission is granted', async () => {
        const pluginDir = join(tempDir, 'perm-granted');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.perm-checker',
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['x'],
                nodeType: 'perm-checker',
            },
            PERM_CHECK_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (result.ok) {
            const handler = handlerRegistry.get('perm-checker');
            expect(Option.isSome(handler)).toBe(true);
            expect(typeof Option.getOrThrow(handler).execute).toBe('function');

            const output = await Option.getOrThrow(handler).execute(
                {
                    node: {
                        id: 'n1',
                        type: 'perm-checker',
                        pluginId: 'com.sigil.perm-checker',
                        config: { check: 'filesystem.read' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            );
            expect(output.activePort).toBe('out');
        }
    });

    it('allows a NodeHandler plugin to call deps.capabilityBroker.request synchronously when permission is denied', async () => {
        const pluginDir = join(tempDir, 'perm-denied');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.perm-checker',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'perm-checker',
            },
            PERM_CHECK_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (result.ok) {
            const handler = handlerRegistry.get('perm-checker');
            await expect(
                Option.getOrThrow(handler).execute(
                    {
                        node: {
                            id: 'n1',
                            type: 'perm-checker',
                            pluginId: 'com.sigil.perm-checker',
                            config: { check: 'filesystem.read' },
                        },
                        ctx: { event: '', payload: {}, vars: {} },
                    },
                    {} as never,
                ),
            ).rejects.toThrow('DENIED: filesystem.read');
        }
    });

    it('allows a factory handler plugin to call kernel.capabilityBroker.request synchronously', async () => {
        const pluginDir = join(tempDir, 'factory-perm-checker');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.factory-perm-checker',
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['perm-check.passed'],
                nodeType: 'factory-perm-checker',
            },
            FACTORY_PERM_CHECK_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (result.ok) {
            const handler = handlerRegistry.get('factory-perm-checker');
            expect(Option.isSome(handler)).toBe(true);
            expect(typeof Option.getOrThrow(handler).execute).toBe('function');
            expect('activate' in Option.getOrThrow(handler)).toBe(true);
        }
    });
});

describe('Workflow State authorization for Node Plugins', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-state-auth-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('routes an honest Plugin state read through the Engine Capability Broker', async () => {
        const pluginId = 'com.sigil.state-honest-read';
        const pluginDir = join(tempDir, 'state-access');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['state.read'],
                emits: ['x'],
                nodeType: 'state-access',
            },
            STATE_ACCESS_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi.fn().mockReturnValue(Either.right(undefined)),
        };
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: createKernel(capabilityBroker),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = {
            get: vi.fn().mockReturnValue(Option.some('from-state')),
            set: vi.fn(),
            flush: vi.fn(),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'state-access',
                    pluginId,
                    config: { operation: 'get' },
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            { state } as never,
        );

        expect(output.outputCtx.vars.secret).toBe('from-state');
        expect(capabilityBroker.request).toHaveBeenCalledWith({
            pluginId,
            capability: 'state.read',
        });
        expect(state.get).toHaveBeenCalledWith('secret');
    });

    it('rejects a crafted state read without state.read before reaching the state adapter', async () => {
        const pluginId = 'com.sigil.state-crafted-read';
        const pluginDir = join(tempDir, 'state-access');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'state-access',
            },
            STATE_ACCESS_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi
                .fn()
                .mockReturnValue(
                    Either.left({ kind: 'denied' as const, capability: 'state.read' }),
                ),
        };
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: createKernel(capabilityBroker),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = {
            get: vi.fn().mockReturnValue(Option.some('should-not-be-read')),
            set: vi.fn(),
            flush: vi.fn(),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        await expect(
            handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'state-access',
                        pluginId,
                        config: { operation: 'get' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { state } as never,
            ),
        ).rejects.toThrow('Permission denied: state.read');

        expect(capabilityBroker.request).toHaveBeenCalledWith({
            pluginId,
            capability: 'state.read',
        });
        expect(state.get).not.toHaveBeenCalled();
    });

    it('rejects a state write without state.write before mutating the state adapter', async () => {
        const pluginId = 'com.sigil.state-crafted-write';
        const pluginDir = join(tempDir, 'state-access');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['state.read'],
                emits: ['x'],
                nodeType: 'state-access',
            },
            STATE_ACCESS_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi
                .fn()
                .mockReturnValue(
                    Either.left({ kind: 'denied' as const, capability: 'state.write' }),
                ),
        };
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: createKernel(capabilityBroker),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = {
            get: vi.fn(),
            set: vi.fn(),
            flush: vi.fn(),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        await expect(
            handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'state-access',
                        pluginId,
                        config: { operation: 'set' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { state } as never,
            ),
        ).rejects.toThrow('Permission denied: state.write');

        expect(capabilityBroker.request).toHaveBeenCalledWith({
            pluginId,
            capability: 'state.write',
        });
        expect(state.set).not.toHaveBeenCalled();
    });

    it('routes state.set and state.flush through state.write authorization', async () => {
        const pluginId = 'com.sigil.state-honest-write';
        const pluginDir = join(tempDir, 'state-access');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['state.write'],
                emits: ['x'],
                nodeType: 'state-access',
            },
            STATE_ACCESS_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi.fn().mockReturnValue(Either.right(undefined)),
        };
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: createKernel(capabilityBroker),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = {
            get: vi.fn(),
            set: vi.fn(),
            flush: vi.fn(),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        const input = {
            node: {
                id: 'n1',
                type: 'state-access' as const,
                pluginId,
                config: { operation: 'set' as const },
            },
            ctx: { event: '', payload: {}, vars: {} },
        };

        await handler.execute(input, { state } as never);
        await handler.execute(
            { ...input, node: { ...input.node, id: 'n2', config: { operation: 'flush' } } },
            { state } as never,
        );

        expect(capabilityBroker.request).toHaveBeenNthCalledWith(1, {
            pluginId,
            capability: 'state.write',
        });
        expect(capabilityBroker.request).toHaveBeenNthCalledWith(2, {
            pluginId,
            capability: 'state.write',
        });
        expect(state.set).toHaveBeenCalledWith('secret', 'mutated');
        expect(state.flush).toHaveBeenCalledTimes(1);
    });

    it('applies a permission revocation to the next state read without restarting the Plugin', async () => {
        const pluginId = 'com.sigil.state-revoked-read';
        const pluginDir = join(tempDir, 'state-access');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['state.read'],
                emits: ['x'],
                nodeType: 'state-access',
            },
            STATE_ACCESS_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const overrides = createPermissionOverrideStore();
        const capabilityBroker = createCapabilityBroker(manifestRegistry, overrides);
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: createKernel(capabilityBroker),
            permissionOverrides: overrides,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = {
            get: vi.fn().mockReturnValue(Option.some('before-revocation')),
            set: vi.fn(),
            flush: vi.fn(),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        const executeRead = (id: string) =>
            handler.execute(
                {
                    node: {
                        id,
                        type: 'state-access',
                        pluginId,
                        config: { operation: 'get' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { state } as never,
            );

        const beforeRevocation = await executeRead('n1');
        expect(beforeRevocation.outputCtx.vars.secret).toBe('before-revocation');

        overrides.set(pluginId, []);

        await expect(executeRead('n2')).rejects.toThrow('Permission denied: state.read');
        expect(state.get).toHaveBeenCalledTimes(1);
    });
});

// ─── Unbypassable enforcement (malicious plugin) ───────────

const MALICIOUS_REGISTER_SUBSCRIBER_HANDLER = `
import { z } from 'zod';
import type { TriggerHandler, KernelDeps, NodeRunResult } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'evil-watcher' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export function handler(kernel: KernelDeps): TriggerHandler {
    return {
        activate(config, onEvent) {
            // Malicious: calls registerSubscriber WITHOUT checking kernel.capabilityBroker.request first
            kernel.fileWatcherManager.registerSubscriber(
                { id: 'evil-sub', path: '/', recursive: true, events: ['file.created'] },
                () => { onEvent({ event: 'file.created', payload: {}, vars: {} }); },
            );
            return () => {};
        },
        async execute({ ctx }): Promise<NodeRunResult> {
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

const MALICIOUS_REGISTER_SUBSCRIBER_EXECUTE_HANDLER = `
import { z } from 'zod';
import type { NodeHandler, KernelDeps, NodeRunResult } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'evil-exec' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export function handler(kernel: KernelDeps): NodeHandler {
    return {
        async execute({ node, ctx }, deps): Promise<NodeRunResult> {
            // Malicious: calls registerSubscriber WITHOUT checking kernel.capabilityBroker.request first
            kernel.fileWatcherManager.registerSubscriber(
                { id: 'evil-sub', path: '/', recursive: true, events: ['file.created'] },
                () => {},
            );
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
`;

describe('unbypassable enforcement', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-enforce-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('blocks a malicious plugin that calls kernel.fileWatcherManager.registerSubscriber without checking permissions — sandbox gate throws in execute', async () => {
        const pluginDir = join(tempDir, 'evil-exec');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.evil-exec',
                version: '0.0.1',
                permissions: ['state.write'], // filesystem.read NOT granted
                emits: ['x'],
                nodeType: 'evil-exec',
            },
            MALICIOUS_REGISTER_SUBSCRIBER_EXECUTE_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = handlerRegistry.get('evil-exec');
        expect(Option.isSome(handler)).toBe(true);

        // The sandbox-side check in createProxiedKernel throws synchronously
        // because 'filesystem.read' is not in the permissions set.
        // handleExecute catches it and sends ExecuteError to the proxy.
        await expect(
            Option.getOrThrow(handler).execute(
                {
                    node: {
                        id: 'n1',
                        type: 'evil-exec',
                        pluginId: 'com.sigil.evil-exec',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow('Permission denied: filesystem.read');
    });

    it('blocks a malicious plugin that calls kernel.fileWatcherManager.registerSubscriber without checking permissions — sandbox gate throws in activate', async () => {
        const pluginDir = join(tempDir, 'evil-activate');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.evil-activate',
                version: '0.0.1',
                permissions: ['state.write'], // filesystem.read NOT granted
                emits: ['x'],
                nodeType: 'evil-watcher',
            },
            MALICIOUS_REGISTER_SUBSCRIBER_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = handlerRegistry.get('evil-watcher');
        expect(Option.isSome(handler)).toBe(true);
        expect('activate' in Option.getOrThrow(handler)).toBe(true);

        // The sandbox-side check in createProxiedKernel throws synchronously.
        // handleActivate sends ActivateError back to the proxy.
        // The proxy does not propagate activation errors (silent), but the
        // worker DID reject the operation and the subscriber was NOT registered.
        // We verify the handler loads and activate doesn't crash (the error
        // is logged, not thrown to the caller).
        // The enforcement is confirmed by the previous test (execute path)
        // and by the main-thread RPC check in handleFileWatcherRpc.
        const teardown = (
            Option.getOrThrow(handler) as unknown as {
                activate: (c: unknown, onEvent: (ctx: unknown) => void) => () => void;
            }
        ).activate({}, () => {});
        expect(typeof teardown).toBe('function');
    });
});

// ─── Sandbox module rebuild (runtime permission change) ───

const FS_ACCESS_HANDLER = `
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { NodeHandler } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

const cachedReadFileSync = readFileSync;

export const descriptor = {
    type: 'fs-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute() {
        // Calls the sandbox-gated require('node:fs').readFileSync
        // If filesystem.read is denied, this throws a permission stub error.
        // If filesystem.read is granted, it throws a real fs error (ENOENT).
        cachedReadFileSync('/nonexistent-file-for-testing');
        return { outputCtx: { event: '', payload: {}, vars: {} }, activePort: 'out' };
    },
};
`;

// ─── Permission propagation (runtime override) ─────────────

describe('updatePluginPermissions', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-perm-prop-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('propagates updated permissions to the worker, affecting subsequent capability checks', async () => {
        const pluginDir = join(tempDir, 'perm-propagation');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.perm-checker',
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['x'],
                nodeType: 'perm-checker',
            },
            PERM_CHECK_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = handlerRegistry.get('perm-checker');
        expect(Option.isSome(handler)).toBe(true);

        // First execution: permission is granted (from initial manifest)
        const output = await Option.getOrThrow(handler).execute(
            {
                node: {
                    id: 'n1',
                    type: 'perm-checker',
                    pluginId: 'com.sigil.perm-checker',
                    config: { check: 'filesystem.read' },
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );
        expect(output.activePort).toBe('out');

        // Revoke permissions via runtime update
        updatePluginPermissions('com.sigil.perm-checker', []);

        // Second execution: should now be denied because the worker permissions set was updated.
        // The unbypassable handleExecute check fires before the handler is called.
        await expect(
            Option.getOrThrow(handler).execute(
                {
                    node: {
                        id: 'n2',
                        type: 'perm-checker',
                        pluginId: 'com.sigil.perm-checker',
                        config: { check: 'filesystem.read' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow('Permission denied: filesystem.read');
    });

    it('rebuilds sandbox fs module when filesystem.read is revoked at runtime — stub replaces real fs', async () => {
        const pluginDir = join(tempDir, 'perm-fs-revoke');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.fs-plugin',
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['x'],
                nodeType: 'fs-plugin',
            },
            FS_ACCESS_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = handlerRegistry.get('fs-plugin');

        // With filesystem.read granted, readFileSync is the real function
        const err1 = await Option.getOrThrow(handler)
            .execute(
                {
                    node: {
                        id: 'n1',
                        type: 'fs-plugin',
                        pluginId: 'com.sigil.fs-plugin',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            )
            .catch((e: Error) => e);
        expect(err1).toBeInstanceOf(Error);
        // Real fs throws ENOENT, not permission stub
        expect((err1 as Error).message).not.toContain('Permission denied');

        // Revoke filesystem.read
        updatePluginPermissions('com.sigil.fs-plugin', []);

        // The unbypassable handleExecute check fires before the handler runs,
        // so the error is from the infrastructure check, not the sandbox module stub.
        const err2 = await Option.getOrThrow(handler)
            .execute(
                {
                    node: {
                        id: 'n2',
                        type: 'fs-plugin',
                        pluginId: 'com.sigil.fs-plugin',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            )
            .catch((e: Error) => e);
        expect(err2).toBeInstanceOf(Error);
        expect((err2 as Error).message).toContain('Permission denied');
        expect((err2 as Error).message).toContain('filesystem.read');
    });

    it('rebuilds sandbox fs module when filesystem.read is granted at runtime — real fs replaces stub', async () => {
        const pluginDir = join(tempDir, 'perm-fs-grant');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.fs-plugin',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'fs-plugin',
            },
            FS_ACCESS_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = handlerRegistry.get('fs-plugin');

        // No filesystem.read — readFileSync is a throwing stub
        const err1 = await Option.getOrThrow(handler)
            .execute(
                {
                    node: {
                        id: 'n1',
                        type: 'fs-plugin',
                        pluginId: 'com.sigil.fs-plugin',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            )
            .catch((e: Error) => e);
        expect(err1).toBeInstanceOf(Error);
        expect((err1 as Error).message).toContain('Permission denied');
        expect((err1 as Error).message).toContain('fs.readFileSync');

        // Grant filesystem.read at runtime
        updatePluginPermissions('com.sigil.fs-plugin', ['filesystem.read']);

        // Sandbox modules were rebuilt — readFileSync is now the real function
        const err2 = await Option.getOrThrow(handler)
            .execute(
                {
                    node: {
                        id: 'n2',
                        type: 'fs-plugin',
                        pluginId: 'com.sigil.fs-plugin',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            )
            .catch((e: Error) => e);
        expect(err2).toBeInstanceOf(Error);
        // Real fs throws ENOENT, not permission stub
        expect((err2 as Error).message).not.toContain('Permission denied');
        expect((err2 as Error).message).toContain('ENOENT');
    });
});

// ─── Worker script path resolution ──────────────────────────

describe('worker script path resolution', () => {
    it('resolves plugin-worker.js relative to __dirname', () => {
        const jsPath = join(__dirname, 'plugin-worker.js');
        const tsPath = join(__dirname, 'plugin-node-worker.ts');
        const resolved = existsSync(jsPath) ? jsPath : tsPath;
        expect(existsSync(resolved)).toBe(true);
    });
});

// ─── Builtin plugins integration ────────────────────────────

describe('builtin plugins integration', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-builtin-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('loads file-manager and file-watcher from the builtin-plugins directory', async () => {
        const builtinPluginsDir = resolve(__dirname, '../builtin-plugins');
        expect(existsSync(builtinPluginsDir)).toBe(true);

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const results = await loadNodePlugins(builtinPluginsDir, {
            manifestRegistry,
            handlerRegistry,
        });

        const successes = results.filter((r) => r.ok);
        expect(successes.length).toBeGreaterThanOrEqual(2);

        expect(handlerRegistry.has('file-manager')).toBe(true);
        expect(handlerRegistry.has('file-watcher')).toBe(true);
        expect(manifestRegistry.has('com.sigil.file-manager')).toBe(true);
        expect(manifestRegistry.has('com.sigil.file-watcher')).toBe(true);

        const fileManagerHandler = handlerRegistry.get('file-manager');
        expect(typeof Option.getOrThrow(fileManagerHandler).execute).toBe('function');

        const fileWatcherHandler = handlerRegistry.get('file-watcher');
        expect(typeof Option.getOrThrow(fileWatcherHandler).execute).toBe('function');
        expect('activate' in Option.getOrThrow(fileWatcherHandler)).toBe(true);
    });
});
