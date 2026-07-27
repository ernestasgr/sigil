import { EventNameSchema, PluginIdSchema } from '@sigil/contracts/ids';
import { describe, expect, it } from 'vitest';

import {
    createBuilderEventCatalog,
    createBuilderEventCatalogFromManifests,
    eventNameSuggestions,
    payloadFieldSuggestions,
} from './event-catalog.js';

describe('Workflow Builder Event catalog adapter', () => {
    it('keeps Plugin and unknown Events opaque while exposing built-in suggestions', () => {
        const catalog = createBuilderEventCatalog(
            [EventNameSchema.parse('plugin.received')],
            PluginIdSchema.parse('com.example.plugin'),
        );

        expect(catalog.entries.map((entry) => entry.name)).toContain('plugin.received');
        expect(catalog.entries.find((entry) => entry.name === 'plugin.received')).toMatchObject({
            source: 'plugin',
            pluginId: 'com.example.plugin',
            fields: [],
        });
        expect(eventNameSuggestions(catalog).map((option) => option.value)).toContain(
            'file.created',
        );
        expect(payloadFieldSuggestions(catalog).map((option) => option.value)).toContain('size');
    });

    it('adds Events declared by loaded Plugin manifests to the Builder catalog', () => {
        const catalog = createBuilderEventCatalogFromManifests([
            {
                id: PluginIdSchema.parse('com.example.events'),
                emits: [EventNameSchema.parse('plugin.received')],
            },
        ]);

        expect(catalog.entries).toContainEqual(
            expect.objectContaining({
                name: 'plugin.received',
                source: 'plugin',
                pluginId: 'com.example.events',
                fields: [],
            }),
        );
    });
});
