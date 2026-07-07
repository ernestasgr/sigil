import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createManifestRegistry } from './manifest-registry.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { createFileWatcherManager } from './file-watcher-manager.js';
import { loadNodePlugin, loadNodePlugins } from './node-plugin-loader.js';

const testBroker: CapabilityBroker = { request: () => ({ ok: true }) };

function createRegistries() {
    const manifestRegistry = createManifestRegistry();
    const handlerRegistry = createNodeHandlerRegistry(
        createBuiltinHandlers({
            fileWatcherManager: createFileWatcherManager(),
            capabilityBroker: testBroker,
        }),
    );
    return { manifestRegistry, handlerRegistry };
}

function writePlugin(dir: string, manifest: Record<string, unknown>, handlerCode: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'handler.ts'), handlerCode);
}

const GREET_PLUGIN_HANDLER = `
import { z } from 'zod';

const GreetConfigSchema = z.object({ name: z.string() });

export const descriptor = {
    type: 'greet',
    configSchema: GreetConfigSchema,
    defaultConfig: { name: 'world' },
    getOutputPorts: () => ['out'],
};

export const handler = {
    async execute({ node, ctx }, deps) {
        const config = node.config;
        deps.bus.next({ name: 'greet.output', payload: { message: 'hello ' + config.name } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

const TRIGGER_PLUGIN_HANDLER = `
import { z } from 'zod';

const TickConfigSchema = z.object({ intervalMs: z.number() });

export const descriptor = {
    type: 'tick-trigger',
    configSchema: TickConfigSchema,
    defaultConfig: { intervalMs: 100 },
    getOutputPorts: () => ['out'],
};

export const handler = {
    activate(config, onEvent) {
        const c = config;
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
            expect(result.error.kind).toBe('type_mismatch');
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

    it('fails when handler module has a syntax error (import_error)', async () => {
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
            expect(result.error.kind).toBe('import_error');
        }
    });

    it('fails when handler module loads but does not expose a valid entrypoint (invalid_handler_module)', async () => {
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
            expect(result.error.kind).toBe('invalid_handler_module');
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
