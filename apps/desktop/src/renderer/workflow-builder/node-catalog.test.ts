import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    createNodeCatalog,
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
});
