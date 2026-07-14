import { describe, expect, it } from 'vitest';

import { nodeOutputPorts, resolveNodeCatalogEntry } from './node-catalog.js';

describe('Workflow Builder Node catalog', () => {
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
});
