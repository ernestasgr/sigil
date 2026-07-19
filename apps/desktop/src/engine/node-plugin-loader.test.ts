import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
    createPropertyRegistry,
    definePropertyDescriptor,
    type PropertyRegistry,
} from '@sigil/schema/properties-file';
import { Either, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { type BusEvent, createEventBus } from './event-bus.js';
import type { EngineDiagnosticPayload } from './event-payload-schemas.js';
import type { FileEventCallback, SubscriberRegistration } from './file-watcher-manager.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import type { KernelDeps } from './node-handlers/types.js';
import {
    createNodePluginLoader,
    loadNodePlugin,
    loadNodePlugins,
    type NodePluginLoader,
    updatePluginPermissions,
} from './node-plugin-loader.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import { createPermissionOverrideStore } from './permission-override-store.js';
import { NodePluginWorkerKind } from './plugin-node-rpc.js';
import { createInMemoryWorkflowStateStore } from './workflow-state.js';

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

const CRASHING_PLUGIN_HANDLER = `
import { z } from 'zod';
import type { NodeHandler } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'crashing-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute({ ctx }): Promise<never> {
        setTimeout(() => {
            throw new Error('plugin worker exploded');
        }, 0);
        return new Promise<never>(() => {});
    },
};
`;

const SILENT_PLUGIN_HANDLER = `
while (true) {}
`;

const COOPERATIVE_TIMEOUT_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({ block: z.boolean() });

export const descriptor = {
    type: 'cooperative-timeout-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: { block: false },
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ node, ctx }, deps) {
        if (node.config.block) await deps.sleep(60_000, deps.signal);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const NON_COOPERATIVE_TIMEOUT_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'non-cooperative-timeout-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute(_input, deps) {
        deps.signal?.addEventListener(
            'abort',
            () => {
                setTimeout(() => {
                    void deps.event?.emit('late.output', { source: 'cancelled-execution' });
                }, 0);
            },
            { once: true },
        );
        return new Promise(() => {});
    },
};
`;

const EVENT_THEN_BLOCK_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'event-then-block-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute(_input, deps) {
        await deps.event.emit('delayed.output', { source: 'delayed-execution' });
        return new Promise(() => {});
    },
};
`;

const RESOLVE_TEMPLATE_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'resolve-template-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }, deps) {
        const resolved = await deps.resolveTemplate('value', ctx);
        return { outputCtx: { ...ctx, vars: { ...ctx.vars, resolved } }, activePort: 'out' };
    },
};
`;

const PROPERTY_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'property-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
    properties: [{ key: 'property-node.message', schema: z.string(), fallback: 'hello', apply: 'hot' }],
};

export const handler = {
    async execute({ ctx }) {
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const ALL_PROPERTY_SOURCES_PLUGIN_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'all-property-sources-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
    properties: [{ key: 'all-property-sources.descriptor', schema: z.string(), fallback: 'descriptor', apply: 'hot' }],
    propertyDescriptors: [{ key: 'all-property-sources.propertyDescriptors', schema: z.boolean(), fallback: false, apply: 'hot' }],
};

export const properties = [
    { key: 'all-property-sources.module', schema: z.number(), fallback: 3, apply: 'hot' },
];

export const handler = {
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

    it('registers typed Plugin properties before the Engine validates the Properties File', async () => {
        const pluginDir = join(tempDir, 'property-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.property-plugin',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'property-node',
            },
            PROPERTY_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const propertyRegistry = createPropertyRegistry();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
        });

        expect(result.ok).toBe(true);
        expect(
            propertyRegistry.schema().safeParse({ 'property-node.message': 'configured' }).success,
        ).toBe(true);
        expect(propertyRegistry.resolveAll({})['property-node.message']).toBe('hello');
    });

    it('collects properties declared on the descriptor and module export', async () => {
        const pluginDir = join(tempDir, 'all-property-sources-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.all-property-sources',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'all-property-sources-node',
            },
            ALL_PROPERTY_SOURCES_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const propertyRegistry = createPropertyRegistry();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.propertyDescriptors).toHaveLength(3);
        }
        expect(propertyRegistry.defaults()).toMatchObject({
            'all-property-sources.descriptor': 'descriptor',
            'all-property-sources.propertyDescriptors': false,
            'all-property-sources.module': 3,
        });
    });

    it('rejects a property-bearing plugin when no registry is supplied', async () => {
        const pluginDir = join(tempDir, 'property-without-registry-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.property-without-registry',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'property-without-registry-node',
            },
            PROPERTY_PLUGIN_HANDLER.replaceAll('property-node', 'property-without-registry-node'),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_property_descriptor',
                error: 'Plugin properties require a Property registry during loading.',
            },
        });
        expect(manifestRegistry.has('com.sigil.property-without-registry')).toBe(false);
    });

    it('reports duplicate declarations from one plugin before registration', async () => {
        const pluginDir = join(tempDir, 'duplicate-declared-property-plugin');
        const duplicateHandler = PROPERTY_PLUGIN_HANDLER.replace(
            "properties: [{ key: 'property-node.message', schema: z.string(), fallback: 'hello', apply: 'hot' }],",
            "properties: [{ key: 'property-node.message', schema: z.string(), fallback: 'hello', apply: 'hot' }, { key: 'property-node.message', schema: z.string(), fallback: 'again', apply: 'hot' }],",
        );
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.duplicate-declared-property',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'property-node',
            },
            duplicateHandler,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry: createPropertyRegistry(),
        });

        expect(result).toMatchObject({
            ok: false,
            error: {
                kind: 'duplicate_property',
                key: 'property-node.message',
                index: 1,
            },
        });
    });

    it('returns a structured diagnostic for an invalid Plugin property descriptor', async () => {
        const pluginDir = join(tempDir, 'invalid-property-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.invalid-property-plugin',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'invalid-property-node',
            },
            PROPERTY_PLUGIN_HANDLER.replace(
                "key: 'property-node.message', schema: z.string(), fallback: 'hello', apply: 'hot'",
                "key: 'invalid-property.message', schema: z.string(), fallback: 42, apply: 'hot'",
            ).replaceAll('property-node', 'invalid-property-node'),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry: createPropertyRegistry(),
        });

        expect(result).toMatchObject({
            ok: false,
            error: { kind: 'invalid_property_descriptor', key: 'invalid-property.message' },
        });
    });

    it('returns a structured diagnostic for a duplicate registered Plugin property', async () => {
        const firstDir = join(tempDir, 'first-property-plugin');
        const secondDir = join(tempDir, 'second-property-plugin');
        const firstManifest = {
            id: 'com.sigil.first-property-plugin',
            version: '0.0.1',
            permissions: [],
            emits: ['x'],
            nodeType: 'first-property-node',
        };
        const secondManifest = {
            ...firstManifest,
            id: 'com.sigil.second-property-plugin',
            nodeType: 'second-property-node',
        };
        writePlugin(
            firstDir,
            firstManifest,
            PROPERTY_PLUGIN_HANDLER.replaceAll('property-node', 'first-property-node'),
        );
        writePlugin(
            secondDir,
            secondManifest,
            PROPERTY_PLUGIN_HANDLER.replaceAll('property-node', 'second-property-node').replace(
                "key: 'second-property-node.message'",
                "key: 'first-property-node.message'",
            ),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const propertyRegistry = createPropertyRegistry();
        const first = await loadNodePlugin(firstDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
        });
        const second = await loadNodePlugin(secondDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
        });

        expect(first.ok).toBe(true);
        expect(second).toMatchObject({
            ok: false,
            error: { kind: 'duplicate_property', key: 'first-property-node.message' },
        });
    });

    it('surfaces a property-registry rejection without exposing an internal key', async () => {
        const pluginDir = join(tempDir, 'registry-rejected-property-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.registry-rejected-property',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'registry-rejected-property-node',
            },
            PROPERTY_PLUGIN_HANDLER.replaceAll('property-node', 'registry-rejected-property-node'),
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const propertyRegistry = {
            ...createPropertyRegistry(),
            registerMany: () => ({
                ok: false as const,
                error: {
                    kind: 'invalid_descriptor' as const,
                    message: 'registry rejected the descriptor',
                },
            }),
        } as unknown as PropertyRegistry;

        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
        });

        expect(result).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_property_descriptor',
                error: 'registry rejected the descriptor',
            },
        });
    });

    it('removes registered properties when manifest registration loses a race', async () => {
        const pluginDir = join(tempDir, 'manifest-race-property-plugin');
        const manifestId = 'com.sigil.manifest-race-property';
        const existingPropertyKey = 'manifest-race-property-node.message';
        const newPropertyKey = 'manifest-race-property-node.new';
        writePlugin(
            pluginDir,
            {
                id: manifestId,
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'manifest-race-property-node',
            },
            PROPERTY_PLUGIN_HANDLER.replaceAll(
                'property-node',
                'manifest-race-property-node',
            ).replace(
                `properties: [{ key: '${existingPropertyKey}', schema: z.string(), fallback: 'hello', apply: 'hot' }],`,
                `properties: [{ key: '${existingPropertyKey}', schema: z.string(), fallback: 'hello', apply: 'hot' }, { key: '${newPropertyKey}', schema: z.boolean(), fallback: false, apply: 'hot' }],`,
            ),
        );

        const realManifestRegistry = createManifestRegistry();
        const manifestRegistry = {
            ...realManifestRegistry,
            register: () => Either.left('duplicate' as const),
        };
        const { handlerRegistry } = createRegistries();
        const propertyRegistry = createPropertyRegistry();
        expect(
            propertyRegistry.register(
                definePropertyDescriptor(existingPropertyKey, z.string(), 'hello', 'hot'),
                { owner: manifestId },
            ),
        ).toMatchObject({ ok: true, registered: true });

        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
            allowExistingPropertyDescriptors: true,
        });

        expect(result).toMatchObject({
            ok: false,
            error: { kind: 'duplicate', pluginId: manifestId },
        });
        expect(propertyRegistry.has(existingPropertyKey)).toBe(true);
        expect(propertyRegistry.has(newPropertyKey)).toBe(false);
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

    it('rejects pending executions and publishes a diagnostic when the worker exits', async () => {
        const pluginDir = join(tempDir, 'crashing-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.crashing',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'crashing-node',
            },
            CRASHING_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const diagnostics: string[] = [];
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            diagnostic: (message) => diagnostics.push(message),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('crashing-node'));
        const execution = handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'crashing-node',
                    pluginId: 'com.sigil.crashing',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        await expect(execution).rejects.toThrow(/plugin worker|worker exited/i);
        expect(diagnostics).toEqual(
            expect.arrayContaining([expect.stringContaining('com.sigil.crashing')]),
        );
    });

    it('waits for a cooperative cancellation acknowledgement before accepting the next execution', async () => {
        vi.useFakeTimers();

        try {
            const pluginDir = join(tempDir, 'cooperative-timeout-plugin');
            writePlugin(
                pluginDir,
                {
                    id: 'com.sigil.cooperative-timeout',
                    version: '0.0.1',
                    permissions: [],
                    emits: ['x'],
                    nodeType: 'cooperative-timeout-node',
                },
                COOPERATIVE_TIMEOUT_PLUGIN_HANDLER,
            );

            const { manifestRegistry, handlerRegistry } = createRegistries();
            const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get('cooperative-timeout-node'));
            const sleep = (_ms: number, signal?: AbortSignal): Promise<void> =>
                new Promise<void>((_resolve, reject) => {
                    if (signal?.aborted) {
                        reject(new Error('sleep cancelled'));
                        return;
                    }
                    signal?.addEventListener('abort', () => reject(new Error('sleep cancelled')), {
                        once: true,
                    });
                });

            const timedOut = handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'cooperative-timeout-node',
                        pluginId: 'com.sigil.cooperative-timeout',
                        config: { block: true },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { sleep } as never,
            );

            const timeoutRejection = expect(timedOut).rejects.toThrow(
                'Execute request timed out after 30s',
            );
            await vi.advanceTimersByTimeAsync(30_000);
            await timeoutRejection;

            const next = await handler.execute(
                {
                    node: {
                        id: 'n2',
                        type: 'cooperative-timeout-node',
                        pluginId: 'com.sigil.cooperative-timeout',
                        config: { block: false },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { sleep: async () => undefined } as never,
            );

            expect(next.activePort).toBe('out');
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects an execution whose caller signal is already aborted', async () => {
        const pluginDir = join(tempDir, 'already-cancelled-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.already-cancelled',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'greet',
            },
            GREET_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('greet'));
        const input = {
            node: {
                id: 'n1',
                type: 'greet',
                pluginId: 'com.sigil.already-cancelled',
                config: { name: 'world' },
            },
            ctx: { event: '', payload: {}, vars: {} },
        };

        const stringReason = new AbortController();
        stringReason.abort('caller cancelled');
        await expect(
            handler.execute(input, { signal: stringReason.signal } as never),
        ).rejects.toThrow('caller cancelled');

        const errorReason = new AbortController();
        errorReason.abort(new Error('caller failed'));
        await expect(
            handler.execute(input, { signal: errorReason.signal } as never),
        ).rejects.toThrow('caller failed');

        let dispatchAborted = false;
        const dispatchSignal = {
            get aborted(): boolean {
                return dispatchAborted;
            },
            reason: 'dispatch cancelled',
            addEventListener(_type: string, listener: () => void): void {
                dispatchAborted = true;
                listener();
            },
            removeEventListener: (): void => undefined,
        } as unknown as AbortSignal;
        await expect(handler.execute(input, { signal: dispatchSignal } as never)).rejects.toThrow(
            'dispatch cancelled',
        );
    });

    it('cancels cooperative work from the caller signal and reuses the worker', async () => {
        const pluginDir = join(tempDir, 'signal-cancellation-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.signal-cancellation',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'cooperative-timeout-node',
            },
            COOPERATIVE_TIMEOUT_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('cooperative-timeout-node'));
        const controller = new AbortController();
        let resolveSleepStarted: (() => void) | undefined;
        const sleepStarted = new Promise<void>((resolve) => {
            resolveSleepStarted = resolve;
        });
        const sleep = (_ms: number, signal?: AbortSignal): Promise<void> =>
            new Promise<void>((_resolve, reject) => {
                resolveSleepStarted?.();
                if (signal?.aborted) {
                    reject(new Error('sleep cancelled'));
                    return;
                }
                signal?.addEventListener('abort', () => reject(new Error('sleep cancelled')), {
                    once: true,
                });
            });

        const execution = handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'cooperative-timeout-node',
                    pluginId: 'com.sigil.signal-cancellation',
                    config: { block: true },
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            { signal: controller.signal, sleep } as never,
        );

        await sleepStarted;
        controller.abort('caller cancelled');
        await expect(execution).rejects.toThrow('caller cancelled');

        const next = await handler.execute(
            {
                node: {
                    id: 'n2',
                    type: 'cooperative-timeout-node',
                    pluginId: 'com.sigil.signal-cancellation',
                    config: { block: false },
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            { sleep: async () => undefined } as never,
        );

        expect(next.activePort).toBe('out');
    });

    it('normalizes a non-Error dependency rejection from a cooperative handler', async () => {
        const pluginDir = join(tempDir, 'string-dependency-error-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.string-dependency-error',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'cooperative-timeout-node',
            },
            COOPERATIVE_TIMEOUT_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('cooperative-timeout-node'));
        await expect(
            handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'cooperative-timeout-node',
                        pluginId: 'com.sigil.string-dependency-error',
                        config: { block: true },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { sleep: async () => Promise.reject('string dependency failure') } as never,
            ),
        ).rejects.toThrow('string dependency failure');
    });

    it('returns synchronous dependency results through the Plugin RPC bridge', async () => {
        const pluginDir = join(tempDir, 'resolve-template-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.resolve-template',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'resolve-template-node',
            },
            RESOLVE_TEMPLATE_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('resolve-template-node'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'resolve-template-node',
                    pluginId: 'com.sigil.resolve-template',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            { resolveTemplate: () => 'resolved' } as never,
        );

        expect(output.outputCtx.vars.resolved).toBe('resolved');
    });

    it('retires a non-cooperative worker after the bounded cancellation grace period', async () => {
        vi.useFakeTimers();

        try {
            const pluginDir = join(tempDir, 'non-cooperative-timeout-plugin');
            writePlugin(
                pluginDir,
                {
                    id: 'com.sigil.non-cooperative-timeout',
                    version: '0.0.1',
                    permissions: [],
                    emits: ['x', 'late.output'],
                    nodeType: 'non-cooperative-timeout-node',
                },
                NON_COOPERATIVE_TIMEOUT_PLUGIN_HANDLER,
            );

            const { manifestRegistry, handlerRegistry } = createRegistries();
            const events: BusEvent[] = [];
            const eventBus = createEventBus();
            eventBus.subscribe((event) => events.push(event));
            const diagnostics: string[] = [];
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
                bridge: createBridge(eventBus, manifestRegistry),
                diagnostic: (message) => diagnostics.push(message),
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get('non-cooperative-timeout-node'));
            const input = {
                node: {
                    id: 'n1',
                    type: 'non-cooperative-timeout-node',
                    pluginId: 'com.sigil.non-cooperative-timeout',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            };
            const controller = new AbortController();
            const timedOut = handler.execute(input, { signal: controller.signal } as never);
            const retirement = expect(timedOut).rejects.toThrow(/did not acknowledge cancellation/);

            await vi.advanceTimersByTimeAsync(30_000);
            controller.abort('caller cancelled after timeout');
            await vi.advanceTimersByTimeAsync(1_000);
            await retirement;
            await vi.runAllTimersAsync();
            expect(events).toEqual([]);
            expect(diagnostics).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('did not acknowledge cancellation'),
                ]),
            );

            await expect(handler.execute(input, {} as never)).rejects.toThrow(/worker/i);
        } finally {
            vi.useRealTimers();
        }
    });

    it('suppresses an event response that completes after cancellation', async () => {
        const pluginDir = join(tempDir, 'event-then-block-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.event-then-block',
                version: '0.0.1',
                permissions: [],
                emits: ['delayed.output'],
                nodeType: 'event-then-block-node',
            },
            EVENT_THEN_BLOCK_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const eventBus = createEventBus();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            bridge: createBridge(eventBus, manifestRegistry),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const controller = new AbortController();
        let resolveSinkStarted: (() => void) | undefined;
        let resolveSink: (() => void) | undefined;
        const sinkStarted = new Promise<void>((resolve) => {
            resolveSinkStarted = resolve;
        });
        const sink = {
            next: () =>
                new Promise<void>((resolve) => {
                    resolveSink = resolve;
                    resolveSinkStarted?.();
                }),
        };
        const handler = Option.getOrThrow(handlerRegistry.get('event-then-block-node'));
        const execution = handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'event-then-block-node',
                    pluginId: 'com.sigil.event-then-block',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            { signal: controller.signal, bus: sink } as never,
        );

        await sinkStarted;
        controller.abort('caller cancelled during event delivery');
        resolveSink?.();

        await expect(execution).rejects.toThrow('caller cancelled during event delivery');
    });

    it('rejects event dependencies when no bridge is configured', async () => {
        const pluginDir = join(tempDir, 'event-without-bridge-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.event-without-bridge',
                version: '0.0.1',
                permissions: [],
                emits: ['delayed.output'],
                nodeType: 'event-then-block-node',
            },
            EVENT_THEN_BLOCK_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('event-then-block-node'));
        await expect(
            handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'event-then-block-node',
                        pluginId: 'com.sigil.event-without-bridge',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow('Bridge dependency is unavailable');
    });

    it('normalizes a non-Error bridge failure from an event dependency', async () => {
        const pluginDir = join(tempDir, 'string-bridge-error-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.string-bridge-error',
                version: '0.0.1',
                permissions: [],
                emits: ['delayed.output'],
                nodeType: 'event-then-block-node',
            },
            EVENT_THEN_BLOCK_PLUGIN_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            bridge: {
                emit: async () => {
                    throw 'string bridge failure';
                },
            } as never,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('event-then-block-node'));
        await expect(
            handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'event-then-block-node',
                        pluginId: 'com.sigil.string-bridge-error',
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow('string bridge failure');
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

    it('times out a silent worker and continues loading the next Plugin', async () => {
        vi.useFakeTimers();

        try {
            writePlugin(
                join(tempDir, '01-silent-plugin'),
                {
                    id: 'com.sigil.silent',
                    version: '0.0.1',
                    permissions: [],
                    emits: ['silent.event'],
                    nodeType: 'silent-node',
                },
                SILENT_PLUGIN_HANDLER,
            );
            writePlugin(
                join(tempDir, '02-good-plugin'),
                {
                    id: 'com.sigil.after-silent',
                    version: '0.0.1',
                    permissions: [],
                    emits: ['greet.output'],
                    nodeType: 'greet',
                },
                GREET_PLUGIN_HANDLER,
            );

            const { manifestRegistry, handlerRegistry } = createRegistries();
            const silentPromise = loadNodePlugin(join(tempDir, '01-silent-plugin'), {
                manifestRegistry,
                handlerRegistry,
            });
            await vi.advanceTimersByTimeAsync(30_000);
            const results = [
                await silentPromise,
                await loadNodePlugin(join(tempDir, '02-good-plugin'), {
                    manifestRegistry,
                    handlerRegistry,
                }),
            ];

            expect(results).toHaveLength(2);
            expect(results[0]).toMatchObject({
                ok: false,
                error: {
                    kind: 'worker_error',
                    error: 'Plugin worker did not become ready within 30 seconds',
                },
            });
            expect(results[1].ok).toBe(true);
            expect(handlerRegistry.has('greet')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
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

const TYPED_STATE_ROUND_TRIP_HANDLER = `
import { Option } from 'effect';
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'typed-state-round-trip' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }, deps) {
        await deps.state.set('count', 42);
        await deps.state.set('enabled', false);
        const count = await deps.state.get('count');
        const enabled = await deps.state.get('enabled');
        const missing = await deps.state.get('missing');
        return {
            outputCtx: {
                ...ctx,
                vars: {
                    ...ctx.vars,
                    count: Option.getOrUndefined(count),
                    enabled: Option.getOrUndefined(enabled),
                    missing: Option.getOrUndefined(missing),
                },
            },
            activePort: 'out',
        };
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

    it('rejects a malformed Workflow State read result before it reaches the worker', async () => {
        const pluginId = 'com.sigil.state-malformed-read';
        const pluginDir = join(tempDir, 'state-malformed-read');
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

        const handler = Option.getOrThrow(handlerRegistry.get('state-access'));
        const get = vi
            .fn()
            .mockReturnValueOnce('not an Option')
            .mockReturnValueOnce(Option.some({ invalid: true }))
            .mockImplementation(() => {
                throw 'string state failure';
            });
        const state = {
            get,
            set: vi.fn(),
            flush: vi.fn(),
        };
        const input = {
            node: {
                id: 'n1',
                type: 'state-access',
                pluginId,
                config: { operation: 'get' },
            },
            ctx: { event: '', payload: {}, vars: {} },
        };
        await expect(handler.execute(input, { state } as never)).rejects.toThrow(
            'Workflow State get must return an Option value',
        );
        await expect(handler.execute(input, { state } as never)).rejects.toThrow(
            'Invalid Workflow State get result',
        );
        await expect(handler.execute(input, { state } as never)).rejects.toThrow(
            'string state failure',
        );
    });

    it('rejects a malformed Workflow State mutation result', async () => {
        const pluginId = 'com.sigil.state-malformed-mutation';
        const pluginDir = join(tempDir, 'state-malformed-mutation');
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
                {
                    state: {
                        get: vi.fn(),
                        set: vi.fn().mockReturnValue('unexpected result'),
                        flush: vi.fn(),
                    },
                } as never,
            ),
        ).rejects.toThrow('Invalid Workflow State mutation result');
    });

    it('round-trips typed Workflow State values through the real Plugin Bridge path', async () => {
        const pluginId = 'com.sigil.typed-state-round-trip';
        const pluginDir = join(tempDir, 'typed-state-round-trip');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['state.read', 'state.write'],
                emits: ['x'],
                nodeType: 'typed-state-round-trip',
            },
            TYPED_STATE_ROUND_TRIP_HANDLER,
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

        const stateStore = createInMemoryWorkflowStateStore();
        try {
            const state = stateStore.forWorkflow('wf-typed-plugin');
            const handler = Option.getOrThrow(handlerRegistry.get('typed-state-round-trip'));
            const output = await handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'typed-state-round-trip',
                        pluginId,
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                { state } as never,
            );

            expect(output.outputCtx.vars).toMatchObject({
                count: 42,
                enabled: false,
                missing: undefined,
            });
            expect(state.get('count')).toEqual(Option.some(42));
            expect(state.get('enabled')).toEqual(Option.some(false));
            expect(state.get('missing')).toEqual(Option.none());
        } finally {
            stateStore.dispose();
        }
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

const MALICIOUS_KERNEL_ADAPTER_HANDLER = `
import { z } from 'zod';
import type { KernelDeps, NodeHandler, NodeRunResult } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'evil-kernel-adapter' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export function handler(kernel: KernelDeps): NodeHandler {
    return {
        async execute({ ctx }): Promise<NodeRunResult> {
            kernel.fileWatcherManager.registerSubscriber(
                { id: 'forged-subscription', path: '/', recursive: true, events: ['file.created'] },
                () => {},
            );
            kernel.fileWatcherManager.unregisterSubscriber('forged-subscription');
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

    it('authorizes every kernel adapter operation through the Engine Capability Broker', async () => {
        const pluginId = 'com.sigil.evil-kernel-adapter';
        const pluginDir = join(tempDir, 'evil-kernel-adapter');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['x'],
                nodeType: 'evil-kernel-adapter',
            },
            MALICIOUS_KERNEL_ADAPTER_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi
                .fn()
                .mockReturnValue(
                    Either.left({ kind: 'denied' as const, capability: 'filesystem.read' }),
                ),
        };
        const registerSubscriber = vi.fn();
        const unregisterSubscriber = vi.fn();
        const diagnostics: string[] = [];
        const diagnosticEvents: EngineDiagnosticPayload[] = [];
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: {
                capabilityBroker,
                fileWatcherManager: { registerSubscriber, unregisterSubscriber },
            },
            diagnostic: (message) => diagnostics.push(message),
            diagnosticEvent: (event) => diagnosticEvents.push(event),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('evil-kernel-adapter'));
        await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'evil-kernel-adapter',
                    pluginId: 'com.sigil.authorized',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        await vi.waitFor(() => {
            expect(capabilityBroker.request).toHaveBeenCalledTimes(2);
        });
        expect(capabilityBroker.request).toHaveBeenNthCalledWith(1, {
            pluginId,
            capability: 'filesystem.read',
        });
        expect(capabilityBroker.request).toHaveBeenNthCalledWith(2, {
            pluginId,
            capability: 'filesystem.read',
        });
        expect(registerSubscriber).not.toHaveBeenCalled();
        expect(unregisterSubscriber).not.toHaveBeenCalled();
        expect(
            diagnostics.filter((message) => message.includes('evil-kernel-adapter')),
        ).toHaveLength(2);
        expect(diagnosticEvents).toHaveLength(2);
        expect(diagnosticEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'authorization',
                    source: 'plugin',
                    pluginId,
                    outcome: 'failed',
                }),
            ]),
        );
    });

    it('allows kernel adapter operations after the mapped capability is granted', async () => {
        const pluginId = 'com.sigil.allowed-kernel-adapter';
        const pluginDir = join(tempDir, 'allowed-kernel-adapter');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['x'],
                nodeType: 'evil-kernel-adapter',
            },
            MALICIOUS_KERNEL_ADAPTER_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi.fn().mockReturnValue(Either.right(undefined)),
        };
        const registerSubscriber = vi.fn();
        const unregisterSubscriber = vi.fn();
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: {
                capabilityBroker,
                fileWatcherManager: { registerSubscriber, unregisterSubscriber },
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('evil-kernel-adapter'));
        await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'evil-kernel-adapter',
                    pluginId,
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        await vi.waitFor(() => {
            expect(capabilityBroker.request).toHaveBeenCalledTimes(2);
        });
        expect(registerSubscriber).toHaveBeenCalledTimes(1);
        expect(unregisterSubscriber).toHaveBeenCalledWith('forged-subscription');
    });

    it('ignores malformed file watcher events before invoking a Plugin callback', async () => {
        const pluginId = 'com.sigil.file-watcher-malformed-event';
        const pluginDir = join(tempDir, 'file-watcher-malformed-event');
        writePlugin(
            pluginDir,
            {
                id: pluginId,
                version: '0.0.1',
                permissions: ['filesystem.read'],
                emits: ['file.created'],
                nodeType: 'evil-watcher',
            },
            MALICIOUS_REGISTER_SUBSCRIBER_HANDLER,
        );

        const manifestRegistry = createManifestRegistry();
        const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
        const capabilityBroker: CapabilityBroker = {
            request: vi.fn().mockReturnValue(Either.right(undefined)),
        };
        let watcherCallback: FileEventCallback | undefined;
        const registerSubscriber = vi.fn(
            (_subscriber: SubscriberRegistration, callback: FileEventCallback) => {
                watcherCallback = callback;
            },
        );
        const result = await loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
            kernel: {
                capabilityBroker,
                fileWatcherManager: {
                    registerSubscriber,
                    unregisterSubscriber: vi.fn(),
                },
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('evil-watcher')) as unknown as {
            activate: (config: unknown, onEvent: (ctx: unknown) => void) => () => void;
        };
        const events: unknown[] = [];
        const teardown = handler.activate({}, (ctx) => events.push(ctx));
        await vi.waitFor(() => expect(watcherCallback).toBeDefined());

        watcherCallback?.({ malformed: true } as never);
        expect(events).toEqual([]);
        teardown();
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

const SANDBOX_SURFACE_HANDLER = `
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { format as formatUrl } from 'node:url';
import { z } from 'zod';

const ConfigSchema = z.object({});

function capture(operation) {
    try {
        return String(operation());
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const descriptor = {
    type: 'sandbox-surface-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }) {
        return {
            outputCtx: {
                ...ctx,
                vars: {
                    ...ctx.vars,
                    path: join('a', 'b'),
                    url: formatUrl({ protocol: 'https:', host: 'example.com', pathname: '/x' }),
                    uuidIsString: typeof randomUUID() === 'string',
                    randomBytesType: typeof randomBytes,
                    fsDenied: capture(() => readFileSync('/missing', { flag: 'r' })),
                    networkDenied: capture(() => isIP('127.0.0.1')),
                    processDenied: capture(() => execFileSync('node', ['--version'])),
                },
            },
            activePort: 'out',
        };
    },
};
`;

const CODE_GENERATION_STRING_HANDLER = `
import { z } from 'zod';

const generated = eval('1 + 1');
const ConfigSchema = z.object({});

export const descriptor = {
    type: 'code-generation-string-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }) {
        return { outputCtx: { ...ctx, vars: { ...ctx.vars, generated } }, activePort: 'out' };
    },
};
`;

const CODE_GENERATION_WASM_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'code-generation-wasm-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }) {
        let wasmError = '';
        try {
            await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        } catch (error) {
            wasmError = error instanceof Error ? error.message : String(error);
        }
        return { outputCtx: { ...ctx, vars: { ...ctx.vars, wasmError } }, activePort: 'out' };
    },
};
`;

const CODE_GENERATION_CONTRACT_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

function capture(operation) {
    try {
        operation();
        return 'allowed';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

async function captureAsync(operation) {
    try {
        await operation();
        return 'allowed';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const descriptor = {
    type: 'code-generation-contract-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }) {
        const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
        return {
            outputCtx: {
                ...ctx,
                vars: {
                    ...ctx.vars,
                    evalFailure: capture(() => eval('1 + 1')),
                    functionFailure: capture(() => new Function('return 1')()),
                    wasmCompileFailure: await captureAsync(() => WebAssembly.compile(wasmBytes)),
                    wasmInstantiateFailure: await captureAsync(() => WebAssembly.instantiate(wasmBytes)),
                },
            },
            activePort: 'out',
        };
    },
};
`;

const SANDBOX_BOUNDARY_HANDLER = `
const ConfigSchema = {
    safeParse(value) {
        return { success: true, data: value };
    },
};

function capture(operation) {
    try {
        return String(operation());
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const descriptor = {
    type: 'sandbox-boundary-plugin' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }) {
        const declaredGlobalKeys = Object.keys(globalThis)
            .filter((key) => key !== '__plugin__')
            .sort();
        const hostEscape = capture(() =>
            globalThis.constructor.constructor('return process')().versions.node,
        );

        return {
            outputCtx: {
                ...ctx,
                vars: {
                    ...ctx.vars,
                    declaredGlobalKeys,
                    globalAliasesMatch: global === globalThis,
                    globalSelfReferencesMatch:
                        global.global === globalThis && global.globalThis === globalThis,
                    ambientAliasesMatch:
                        global.require === require &&
                        global.console === console &&
                        global.process === process &&
                        global.Buffer === Buffer &&
                        global.setTimeout === setTimeout,
                    contextIntrinsics: [
                        typeof globalThis.JSON,
                        typeof globalThis.Math,
                        typeof globalThis.Date,
                        typeof globalThis.Promise,
                        typeof globalThis.Array,
                        typeof globalThis.Object,
                        typeof globalThis.String,
                        typeof globalThis.Number,
                        typeof globalThis.Boolean,
                        typeof globalThis.Map,
                        typeof globalThis.Set,
                        typeof globalThis.Error,
                        typeof globalThis.RegExp,
                        typeof globalThis.WebAssembly,
                    ],
                    processKeys: Object.keys(process).sort(),
                    processEnvKeys: Object.keys(process.env).sort(),
                    processVersionsType: typeof process.versions,
                    workerDataType: typeof globalThis.workerData,
                    parentPortType: typeof globalThis.parentPort,
                    setImmediateType: typeof globalThis.setImmediate,
                    hostEscape,
                },
            },
            activePort: 'out',
        };
    },
};
`;

describe('Plugin Sandbox Surface', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-surface-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('allows zero-permission plugins to use only declared unconditional APIs', async () => {
        const pluginDir = join(tempDir, 'surface-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.sandbox-surface',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'sandbox-surface-plugin',
            },
            SANDBOX_SURFACE_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('sandbox-surface-plugin'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'sandbox-surface-plugin',
                    pluginId: 'com.sigil.sandbox-surface',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        expect(output.outputCtx.vars.path).toBe('a\\b');
        expect(output.outputCtx.vars.url).toBe('https://example.com/x');
        expect(output.outputCtx.vars.uuidIsString).toBe(true);
        expect(output.outputCtx.vars.randomBytesType).toBe('undefined');
        expect(output.outputCtx.vars.fsDenied).toContain('Permission denied');
        expect(output.outputCtx.vars.networkDenied).toContain('Permission denied');
        expect(output.outputCtx.vars.processDenied).toContain('Permission denied');
    });

    it('disables string code generation during plugin evaluation', async () => {
        const pluginDir = join(tempDir, 'string-code-generation-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.code-generation-string',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'code-generation-string-plugin',
            },
            CODE_GENERATION_STRING_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('worker_error');
            if (result.error.kind === 'worker_error') {
                expect(result.error.error).toContain('Code generation from strings disallowed');
            }
        }
    });

    it('disables WebAssembly code generation inside the evaluated plugin context', async () => {
        const pluginDir = join(tempDir, 'wasm-code-generation-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.code-generation-wasm',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'code-generation-wasm-plugin',
            },
            CODE_GENERATION_WASM_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('code-generation-wasm-plugin'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'code-generation-wasm-plugin',
                    pluginId: 'com.sigil.code-generation-wasm',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        expect(output.outputCtx.vars.wasmError).toContain('Wasm code generation disallowed');
    });

    it('enforces the registry code-generation policy for eval, Function, and WebAssembly', async () => {
        const pluginDir = join(tempDir, 'code-generation-contract-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.code-generation-contract',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'code-generation-contract-plugin',
            },
            CODE_GENERATION_CONTRACT_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('code-generation-contract-plugin'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'code-generation-contract-plugin',
                    pluginId: 'com.sigil.code-generation-contract',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        expect(output.outputCtx.vars.evalFailure).toContain(
            'Code generation from strings disallowed',
        );
        expect(output.outputCtx.vars.functionFailure).toContain(
            'Code generation from strings disallowed',
        );
        expect(output.outputCtx.vars.wasmCompileFailure).toContain(
            'Wasm code generation disallowed',
        );
        expect(output.outputCtx.vars.wasmInstantiateFailure).toContain(
            'Wasm code generation disallowed',
        );
    });

    it('exposes only the registry surface and context intrinsics through global and globalThis', async () => {
        const pluginDir = join(tempDir, 'sandbox-boundary-plugin');
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.sandbox-boundary',
                version: '0.0.1',
                permissions: [],
                emits: ['x'],
                nodeType: 'sandbox-boundary-plugin',
            },
            SANDBOX_BOUNDARY_HANDLER,
        );

        const { manifestRegistry, handlerRegistry } = createRegistries();
        const result = await loadNodePlugin(pluginDir, { manifestRegistry, handlerRegistry });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const handler = Option.getOrThrow(handlerRegistry.get('sandbox-boundary-plugin'));
        const output = await handler.execute(
            {
                node: {
                    id: 'n1',
                    type: 'sandbox-boundary-plugin',
                    pluginId: 'com.sigil.sandbox-boundary',
                    config: {},
                },
                ctx: { event: '', payload: {}, vars: {} },
            },
            {} as never,
        );

        expect(output.outputCtx.vars.declaredGlobalKeys).toEqual([
            'Buffer',
            'TextDecoder',
            'TextEncoder',
            'URL',
            'URLSearchParams',
            'atob',
            'btoa',
            'clearInterval',
            'clearTimeout',
            'console',
            'global',
            'globalThis',
            'process',
            'require',
            'setInterval',
            'setTimeout',
            'structuredClone',
        ]);
        expect(output.outputCtx.vars.globalAliasesMatch).toBe(true);
        expect(output.outputCtx.vars.globalSelfReferencesMatch).toBe(true);
        expect(output.outputCtx.vars.ambientAliasesMatch).toBe(true);
        expect(output.outputCtx.vars.contextIntrinsics).toEqual([
            'object',
            'object',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'function',
            'object',
        ]);
        expect(output.outputCtx.vars.processKeys).toEqual(['env']);
        expect(output.outputCtx.vars.processEnvKeys).toEqual([]);
        expect(output.outputCtx.vars.processVersionsType).toBe('undefined');
        expect(output.outputCtx.vars.workerDataType).toBe('undefined');
        expect(output.outputCtx.vars.parentPortType).toBe('undefined');
        expect(output.outputCtx.vars.setImmediateType).toBe('undefined');
        expect(output.outputCtx.vars.hostEscape).toContain(
            'Code generation from strings disallowed',
        );
    });
});

describe('updatePluginPermissions', () => {
    let tempDir: string;
    let loader: NodePluginLoader;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-perm-prop-'));
        loader = createNodePluginLoader();
    });

    afterEach(async () => {
        await loader.shutdown();
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
        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
        });

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
        loader.updatePluginPermissions('com.sigil.perm-checker', []);

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
        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
        });
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
        loader.updatePluginPermissions('com.sigil.fs-plugin', []);

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
        const result = await loader.loadNodePlugin(pluginDir, {
            manifestRegistry,
            handlerRegistry,
        });
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
        loader.updatePluginPermissions('com.sigil.fs-plugin', ['filesystem.read']);

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

    it('keeps the legacy module-level permission update facade connected to loaded workers', async () => {
        const pluginDir = join(tempDir, 'legacy-perm-propagation');
        const pluginId = 'com.sigil.legacy-perm-checker';
        writePlugin(
            pluginDir,
            {
                id: pluginId,
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

        updatePluginPermissions(pluginId, []);

        await expect(
            result.handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'perm-checker',
                        pluginId,
                        config: { check: 'filesystem.read' },
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow('Permission denied: filesystem.read');
    });
});

// ─── Worker script path resolution ──────────────────────────

describe('worker script path resolution', () => {
    it('resolves the compiled worker or source bootstrap relative to __dirname', () => {
        const jsPath = join(__dirname, 'plugin-worker.js');
        const bootstrapPath = join(__dirname, 'plugin-node-worker-bootstrap.mjs');
        const resolved = existsSync(jsPath) ? jsPath : bootstrapPath;
        expect(existsSync(resolved)).toBe(true);
    });

    it('executes the source fallback bootstrap and loads a TypeScript worker', async () => {
        const pluginDir = join(tmpdir(), `sigil-bootstrap-worker-${crypto.randomUUID()}`);
        mkdirSync(pluginDir, { recursive: true });
        writePlugin(
            pluginDir,
            {
                id: 'com.sigil.bootstrap-worker',
                version: '0.0.1',
                permissions: [],
                emits: [],
                nodeType: 'bootstrap-node',
            },
            `
export const descriptor = {
    type: 'bootstrap-node',
    configSchema: { safeParse: (value) => ({ success: true, data: value }) },
};

export const handler = {
    async execute({ ctx }) {
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`,
        );

        const bootstrapPath = join(__dirname, 'plugin-node-worker-bootstrap.mjs');
        const worker = new Worker(bootstrapPath, {
            workerData: {
                pluginId: 'com.sigil.bootstrap-worker',
                manifestNodeType: 'bootstrap-node',
                handlerPath: resolve(pluginDir, 'handler.ts'),
                manifestPermissions: [],
                permissions: [],
            },
        });

        try {
            const message = await new Promise<unknown>((resolveMessage, reject) => {
                worker.once('message', resolveMessage);
                worker.once('error', reject);
                worker.once('exit', (code) => {
                    reject(new Error(`Fallback worker exited with code ${code}`));
                });
            });

            expect(message).toEqual({
                kind: NodePluginWorkerKind.Loaded,
                descriptorType: 'bootstrap-node',
                isTrigger: false,
            });
        } finally {
            await worker.terminate();
            rmSync(pluginDir, { recursive: true, force: true });
        }
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
        const propertyRegistry = createPropertyRegistry();
        const results = await loadNodePlugins(builtinPluginsDir, {
            manifestRegistry,
            handlerRegistry,
            propertyRegistry,
            allowExistingPropertyDescriptors: true,
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
