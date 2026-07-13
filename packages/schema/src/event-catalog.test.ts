import { describe, expect, it } from 'vitest';
import {
    createEventCatalog,
    FILE_EVENT_FIELDS,
    findEvent,
    getEventPayloadFields,
    resolveEvent,
} from './event-catalog.js';
import { FileEventPayloadSchema } from './file-event-payload.js';

describe('Event catalog', () => {
    it('exposes the built-in file Event fields through the catalog seam', () => {
        const catalog = createEventCatalog();

        expect(findEvent(catalog, 'file.created')).toMatchObject({
            name: 'file.created',
            source: 'builtin',
            fields: expect.arrayContaining([
                expect.objectContaining({ path: 'path', kind: 'string' }),
                expect.objectContaining({ path: 'size', kind: 'number' }),
            ]),
        });
        expect(getEventPayloadFields(catalog).map((field) => field.path)).toEqual([
            'path',
            'name',
            'ext',
            'size',
            'dir',
        ]);
        expect(FILE_EVENT_FIELDS.map((field) => field.path)).toEqual(
            Object.keys(FileEventPayloadSchema.shape),
        );
    });

    it('resolves an unknown Event to an opaque entry without inventing fields', () => {
        const catalog = createEventCatalog();

        expect(findEvent(catalog, 'plugin.received')).toBeUndefined();
        expect(resolveEvent(catalog, 'plugin.received')).toEqual({
            name: 'plugin.received',
            label: 'plugin.received',
            description: 'No payload field metadata is available for this Event.',
            source: 'opaque',
            fields: [],
        });
        expect(getEventPayloadFields(catalog, 'plugin.received')).toEqual([]);
    });
});
