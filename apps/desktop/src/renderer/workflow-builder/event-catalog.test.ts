import { describe, expect, it } from 'vitest';

import {
    createBuilderEventCatalog,
    eventNameSuggestions,
    payloadFieldSuggestions,
} from './event-catalog.js';

describe('Workflow Builder Event catalog adapter', () => {
    it('keeps Plugin and unknown Events opaque while exposing built-in suggestions', () => {
        const catalog = createBuilderEventCatalog(['plugin.received'], 'com.example.plugin');

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
});
