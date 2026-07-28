import type { FileEventName } from '@sigil/contracts/events';
import {
    createEventCatalog,
    createPluginEventCatalogEntries,
    DEFAULT_EVENT_CATALOG,
    type EventCatalog,
    type EventCatalogSuggestion,
    type EventFieldMetadata,
    eventCatalogSuggestions,
    eventPayloadFieldSuggestions,
    FILE_EVENT_NAMES,
    findEventField,
} from '@sigil/contracts/events';
import type { EventName, PluginId } from '@sigil/contracts/ids';
import type { Manifest } from '@sigil/contracts/plugins';

export type {
    EventCatalog,
    EventCatalogEntry,
    EventCatalogEntryInput,
    EventCatalogSource,
    EventCatalogSuggestion,
    EventFieldKind,
    EventFieldMetadata,
} from '@sigil/contracts/events';

export const EVENT_CATALOG = DEFAULT_EVENT_CATALOG;

export type EventCatalogManifest = Pick<Manifest, 'id' | 'emits'>;

export type { EventCatalogSuggestion as CatalogSuggestion } from '@sigil/contracts/events';

type CatalogSuggestion = EventCatalogSuggestion;
type EventNameSuggestion = EventCatalogSuggestion<EventName>;

export const EVENT_NAME_OPTIONS: readonly {
    readonly value: FileEventName;
    readonly label: string;
}[] = FILE_EVENT_NAMES.map((name) => ({
    value: name,
    label: name,
}));

export function createBuilderEventCatalog(
    pluginEventNames: readonly EventName[] = [],
    pluginId?: PluginId,
): EventCatalog {
    return createEventCatalog(createPluginEventCatalogEntries(pluginEventNames, pluginId));
}

export function createBuilderEventCatalogFromManifests(
    manifests: readonly EventCatalogManifest[],
): EventCatalog {
    const entries = manifests.flatMap((manifest) =>
        createPluginEventCatalogEntries(manifest.emits, manifest.id),
    );
    return createEventCatalog(entries);
}

export function eventNameSuggestions(
    catalog: EventCatalog = EVENT_CATALOG,
): readonly EventNameSuggestion[] {
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
    eventName?: EventName,
): EventFieldMetadata | undefined {
    return findEventField(catalog, fieldPath, eventName);
}
