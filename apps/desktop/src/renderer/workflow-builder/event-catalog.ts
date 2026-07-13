import {
    BUILTIN_EVENT_CATALOG,
    createEventCatalog,
    createPluginEventCatalogEntries,
    DEFAULT_EVENT_CATALOG,
    type EventCatalog,
    type EventFieldMetadata,
    type FileEventName,
    findEventField,
    getEventPayloadFields,
} from '@sigil/schema/event-catalog';

export type {
    EventCatalog,
    EventCatalogEntry,
    EventCatalogEntryInput,
    EventCatalogSource,
    EventFieldKind,
    EventFieldMetadata,
} from '@sigil/schema/event-catalog';

export const EVENT_CATALOG = DEFAULT_EVENT_CATALOG;

export interface CatalogSuggestion {
    readonly value: string;
    readonly label: string;
    readonly description: string;
}

export const EVENT_NAME_OPTIONS: readonly {
    readonly value: FileEventName;
    readonly label: string;
}[] = BUILTIN_EVENT_CATALOG.map((entry) => ({
    value: entry.name,
    label: entry.name,
}));

export function createBuilderEventCatalog(
    pluginEventNames: readonly string[] = [],
    pluginId?: string,
): EventCatalog {
    return createEventCatalog(createPluginEventCatalogEntries(pluginEventNames, pluginId));
}

export function eventNameSuggestions(
    catalog: EventCatalog = EVENT_CATALOG,
): readonly CatalogSuggestion[] {
    return catalog.entries.map((entry) => ({
        value: entry.name,
        label: entry.label,
        description: entry.description,
    }));
}

export function payloadFieldSuggestions(
    catalog: EventCatalog = EVENT_CATALOG,
): readonly CatalogSuggestion[] {
    return getEventPayloadFields(catalog).map((field) => fieldSuggestion(field));
}

function fieldSuggestion(field: EventFieldMetadata): CatalogSuggestion {
    return {
        value: field.path,
        label: `${field.label} · ${field.kind}`,
        description: field.description,
    };
}

export function payloadFieldMetadata(
    fieldPath: string,
    catalog: EventCatalog = EVENT_CATALOG,
    eventName?: string,
): EventFieldMetadata | undefined {
    return findEventField(catalog, fieldPath, eventName);
}
