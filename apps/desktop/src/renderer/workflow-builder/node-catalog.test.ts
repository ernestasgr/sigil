import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    createNodeCatalog,
    createNodeCatalogFromManifests,
    createPluginNodeCatalogEntry,
    DEFAULT_NODE_CATALOG,
    defaultNodeSpecForCatalogEntry,
    nodeCatalogEntryFromPaletteValue,
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
        expect(nodeOutputPorts(spec)).toBe('dynamic');
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

        expect(resolveNodeCatalogEntry(spec)).toMatchObject({
            source: 'plugin',
            pluginId: 'com.sigil.file-watcher',
            type: 'file-watcher',
            authoring: 'editable',
            isTrigger: true,
            outputPorts: ['out'],
        });
        expect(nodeOutputPorts(spec)).toEqual(['out']);
    });

    it('keeps Plugin defaults, validation, output ports, and Form correlation behind the seam', () => {
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
            authoring: 'editable',
            outputPorts: ['out'],
        });
        expect(resolved.validateConfig?.({ message: '' })).toMatchObject({ ok: false });
        expect(resolved.validateConfig?.({ message: 'updated' })).toEqual({
            ok: true,
            value: { message: 'updated' },
        });
        expect(nodeOutputPorts(spec, catalog)).toEqual(['out']);
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
});
