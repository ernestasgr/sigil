import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    createNodeCatalog,
    createNodeCatalogFromManifests,
    createPluginNodeCatalogEntry,
    DEFAULT_NODE_CATALOG,
    defaultNodeSpecForCatalogEntry,
    nodeCatalogEntryFromPaletteValue,
    nodeOutputPortLabel,
    nodeOutputPorts,
    resolveNodeCatalogEntry,
    serializeNodeCatalogEntry,
} from './node-catalog.js';

describe('Workflow Builder Node catalog', () => {
    it('exposes every built-in Node through the shared authoring contract', () => {
        const builtins = DEFAULT_NODE_CATALOG.entries.filter((entry) => entry.source === 'builtin');

        expect(builtins).not.toHaveLength(0);
        for (const entry of builtins) {
            const validation = entry.validateConfig(entry.defaultConfig);

            expect(validation).toEqual({ ok: true, value: entry.defaultConfig });
            expect(entry.outputPorts(entry.defaultConfig)).not.toEqual([]);
            expect(typeof entry.Form).toBe('function');
        }
    });

    it('keeps an unsupported Plugin Node identifiable and read-only', () => {
        const spec = {
            type: 'third-party.action',
            pluginId: 'com.example.plugin',
            config: { destination: '/tmp' },
        };

        const entry = resolveNodeCatalogEntry(spec);

        expect(entry).toMatchObject({
            source: 'plugin',
            type: 'third-party.action',
            pluginId: 'com.example.plugin',
            authoring: 'read-only',
        });
        expect(entry.description).toMatch(/read-only|authoring/i);
        expect(nodeOutputPorts(spec)).toEqual([]);
    });

    it('resolves the bundled File Watcher plugin adapter without losing plugin identity', () => {
        const spec = {
            type: 'file-watcher',
            pluginId: 'com.sigil.file-watcher',
            config: {
                path: '/tmp',
                recursive: true,
                events: ['file.created'],
            },
        };

        const catalog = createNodeCatalogFromManifests([
            {
                id: 'com.sigil.file-watcher',
                nodeType: 'file-watcher',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.sigil.file-watcher',
                        type: 'file-watcher',
                    },
                    version: 1,
                    role: 'trigger',
                    defaultConfig: {
                        path: '/',
                        recursive: true,
                        events: ['file.created'],
                    },
                    outputPorts: {
                        kind: 'fixed',
                        ports: [{ id: 'out', label: 'Output' }],
                    },
                    display: {
                        label: 'File Watcher',
                        description: 'Watches a path for file events.',
                        category: 'trigger',
                    },
                },
            },
        ]);

        expect(resolveNodeCatalogEntry(spec, catalog)).toMatchObject({
            source: 'plugin',
            pluginId: 'com.sigil.file-watcher',
            type: 'file-watcher',
            authoring: 'editable',
            isTrigger: true,
            outputPorts: ['out'],
        });
        expect(nodeOutputPorts(spec, catalog)).toEqual(['out']);
    });

    it('does not let an adapter provide topology facts without a Node Contract', () => {
        const configSchema = z.object({ message: z.string().min(1) });
        const entry = createPluginNodeCatalogEntry({
            pluginId: 'com.example.message',
            type: 'message-node',
            label: 'Message Node',
            category: 'utility',
            description: 'Writes a message.',
            defaultConfig: { message: 'hello' },
            configSchema,
            isTrigger: false,
            outputPorts: () => ['out'],
            Form: () => null,
        });
        const catalog = createNodeCatalog([entry]);
        const spec = defaultNodeSpecForCatalogEntry(entry);
        const resolved = resolveNodeCatalogEntry(spec, catalog);
        const paletteEntry = nodeCatalogEntryFromPaletteValue(
            serializeNodeCatalogEntry(entry),
            catalog,
        );

        expect(spec).toEqual({
            type: 'message-node',
            pluginId: 'com.example.message',
            config: { message: 'hello' },
        });
        expect(paletteEntry).toMatchObject({
            source: 'plugin',
            pluginId: 'com.example.message',
            type: 'message-node',
        });
        expect(resolved).toMatchObject({
            source: 'plugin',
            pluginId: 'com.example.message',
            type: 'message-node',
            authoring: 'read-only',
            contractStatus: 'unavailable',
            isTrigger: 'unknown',
            outputPorts: [],
        });
        expect(resolved.validateConfig?.({ message: '' })).toMatchObject({ ok: false });
        expect(resolved.validateConfig?.({ message: 'updated' })).toEqual({
            ok: true,
            value: { message: 'updated' },
        });
        expect(nodeOutputPorts(spec, catalog)).toEqual([]);
    });

    it('only exposes Plugin adapters declared by loaded manifests', () => {
        const declared = createPluginNodeCatalogEntry({
            pluginId: 'com.example.declared',
            type: 'declared-node',
            label: 'Declared Node',
            category: 'utility',
            description: 'A declared Plugin Node.',
            defaultConfig: {},
            configSchema: z.object({}),
            isTrigger: false,
            outputPorts: () => ['out'],
        });
        const undeclared = createPluginNodeCatalogEntry({
            pluginId: 'com.example.undeclared',
            type: 'undeclared-node',
            label: 'Undeclared Node',
            category: 'utility',
            description: 'An undeclared Plugin Node.',
            defaultConfig: {},
            configSchema: z.object({}),
            isTrigger: false,
            outputPorts: () => ['out'],
        });

        const catalog = createNodeCatalogFromManifests(
            [{ id: 'com.example.declared', nodeType: 'declared-node' }],
            [declared, undeclared],
        );

        expect(catalog.findPlugin('com.example.declared', 'declared-node')).toMatchObject({
            pluginId: declared.pluginId,
            type: declared.type,
        });
        expect(catalog.findPlugin('com.example.undeclared', 'undeclared-node')).toBeUndefined();
    });

    it('uses a validated manifest contract as the Plugin port and trigger authority', () => {
        const adapter = createPluginNodeCatalogEntry({
            pluginId: 'com.example.contract',
            type: 'contract-trigger',
            label: 'Adapter Label',
            category: 'utility',
            description: 'Adapter description.',
            defaultConfig: { enabled: false },
            configSchema: z.object({ enabled: z.boolean() }),
            isTrigger: false,
            outputPorts: () => ['wrong-port'],
            Form: () => null,
        });
        const catalog = createNodeCatalogFromManifests(
            [
                {
                    id: 'com.example.contract',
                    nodeType: 'contract-trigger',
                    nodeContract: {
                        identity: {
                            namespace: 'plugin',
                            pluginId: 'com.example.contract',
                            type: 'contract-trigger',
                        },
                        version: 1,
                        role: 'trigger',
                        defaultConfig: { enabled: true },
                        outputPorts: {
                            kind: 'fixed',
                            ports: [{ id: 'declared', label: 'Declared output' }],
                        },
                        display: {
                            label: 'Contract Trigger',
                            description: 'Contract description.',
                            category: 'trigger',
                        },
                    },
                },
            ],
            [adapter],
        );

        const spec = {
            type: 'contract-trigger',
            pluginId: 'com.example.contract',
            config: { enabled: true },
        };
        expect(resolveNodeCatalogEntry(spec, catalog)).toMatchObject({
            label: 'Adapter Label',
            category: 'utility',
            defaultConfig: { enabled: false },
            isTrigger: true,
            outputPorts: ['declared'],
        });
        expect(nodeOutputPorts(spec, catalog)).toEqual(['declared']);
        expect(nodeOutputPorts({ ...spec, config: { enabled: false } }, catalog)).toEqual([
            'declared',
        ]);
    });

    it('keeps renderer output ports in parity with a Plugin config-derived contract', () => {
        const catalog = createNodeCatalogFromManifests([
            {
                id: 'com.example.router',
                nodeType: 'router-node',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.example.router',
                        type: 'router-node',
                    },
                    version: 1,
                    role: 'action',
                    defaultConfig: {
                        target: 'event',
                        cases: [{ id: 'ready', value: 'ready' }],
                    },
                    outputPorts: {
                        kind: 'config-derived',
                        strategy: 'switch-cases',
                        defaultPort: { id: 'default', label: 'Fallback' },
                    },
                    display: {
                        label: 'Router Node',
                        description: 'Routes by event name.',
                        category: 'logic',
                    },
                },
            },
        ]);
        const spec = {
            type: 'router-node',
            pluginId: 'com.example.router',
            config: {
                target: 'event',
                cases: [
                    { id: 'ready', value: 'ready' },
                    { id: 'failed', value: 'failed' },
                ],
            },
        };

        expect(nodeOutputPorts(spec, catalog)).toEqual(['default', 'ready', 'failed']);
        expect(resolveNodeCatalogEntry(spec, catalog).outputPortLabel(spec.config, 'default')).toBe(
            'Fallback',
        );

        const changed = {
            ...spec,
            config: { target: 'event' as const, cases: [{ id: 'cancelled', value: 'cancelled' }] },
        };
        expect(nodeOutputPorts(changed, catalog)).toEqual(['default', 'cancelled']);
        expect(
            nodeOutputPorts({ ...spec, config: { target: 'event', cases: [] } }, catalog),
        ).toEqual(['default']);
        expect(
            nodeOutputPorts(
                {
                    ...spec,
                    config: { target: 'event', cases: [{ id: 'empty', value: '' }] },
                },
                catalog,
            ),
        ).toEqual(['default', 'empty']);
        expect(
            nodeOutputPortLabel(
                { ...spec, config: { target: 'event', cases: [{ id: 'empty', value: '' }] } },
                'empty',
                catalog,
            ),
        ).toBe('(empty)');
    });
});
