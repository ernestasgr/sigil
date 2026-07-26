import {
    BUILTIN_EVENT_CATALOG,
    createEventCatalog,
    createPluginEventCatalogEntries,
    DEFAULT_EVENT_CATALOG,
    type EventCatalog,
    type EventCatalogSuggestion,
    type EventFieldMetadata,
    eventCatalogSuggestions,
    eventPayloadFieldSuggestions,
    type FileEventName,
    findEventField,
} from '@sigil/schema/event-catalog';
import { type PluginId, PluginIdSchema } from '@sigil/schema/ids';
import type { Manifest } from '@sigil/schema/manifest';

export type {
    EventCatalog,
    EventCatalogEntry,
    EventCatalogEntryInput,
    EventCatalogSource,
    EventCatalogSuggestion,
    EventFieldKind,
    EventFieldMetadata,
} from '@sigil/schema/event-catalog';

export const EVENT_CATALOG = DEFAULT_EVENT_CATALOG;

export type EventCatalogManifest = Omit<Pick<Manifest, 'id' | 'emits'>, 'id'> & {
    /** UI callers may supply discovered manifest data before schema parsing. */
    readonly id: string;
};

export type { EventCatalogSuggestion as CatalogSuggestion } from '@sigil/schema/event-catalog';

type CatalogSuggestion = EventCatalogSuggestion;

export const EVENT_NAME_OPTIONS: readonly {
    readonly value: FileEventName;
    readonly label: string;
}[] = BUILTIN_EVENT_CATALOG.map((entry) => ({
    value: entry.name,
    label: entry.name,
}));

export function createBuilderEventCatalog(
    pluginEventNames: readonly string[] = [],
    pluginId?: PluginId,
): EventCatalog {
    return createEventCatalog(createPluginEventCatalogEntries(pluginEventNames, pluginId));
}

export function createBuilderEventCatalogFromManifests(
    manifests: readonly EventCatalogManifest[],
): EventCatalog {
    const entries = manifests.flatMap((manifest) =>
        createPluginEventCatalogEntries(manifest.emits, PluginIdSchema.parse(manifest.id)),
    );
    return createEventCatalog(entries);
}

export function eventNameSuggestions(
    catalog: EventCatalog = EVENT_CATALOG,
): readonly CatalogSuggestion[] {
    return eventCatalogSuggestions(catalog);
}

export function payloadFieldSuggestions(
    catalog: EventCatalog = EVENT_CATALOG,
): readonly CatalogSuggestion[] {
    return eventPayloadFieldSuggestions(catalog);
}

export function payloadFieldMetadata(
    fieldPath: string,
    catalog: EventCatalog = EVENT_CATALOG,
    eventName?: string,
): EventFieldMetadata | undefined {
    return findEventField(catalog, fieldPath, eventName);
}
