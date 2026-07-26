import { z } from 'zod';

import { type EventName, EventNameSchema, type PluginId, PluginIdSchema } from './ids.js';

export const FILE_EVENT_NAMES = ['file.created', 'file.modified', 'file.deleted'] as const;
export const FileEventNameSchema = z.enum(FILE_EVENT_NAMES);

export const EventFieldKindSchema = z.enum(['string', 'number', 'boolean']);
export type EventFieldKind = z.infer<typeof EventFieldKindSchema>;

export const EventFieldMetadataSchema = z
    .object({
        path: z.string().min(1),
        kind: EventFieldKindSchema,
        label: z.string().min(1),
        description: z.string().min(1),
    })
    .strict()
    .readonly();
export type EventFieldMetadata = z.infer<typeof EventFieldMetadataSchema>;

const EventCatalogSourceSchema = z.enum(['builtin', 'plugin', 'opaque']);
export type EventCatalogSource = z.infer<typeof EventCatalogSourceSchema>;

export const EventCatalogEntrySchema = z
    .object({
        name: EventNameSchema,
        label: z.string().min(1),
        description: z.string().min(1),
        source: EventCatalogSourceSchema,
        pluginId: PluginIdSchema.optional(),
        fields: z.array(EventFieldMetadataSchema).readonly(),
    })
    .strict()
    .readonly();
export type EventCatalogEntry = z.infer<typeof EventCatalogEntrySchema>;

export interface EventCatalogSuggestion<TValue extends string = string> {
    readonly value: TValue;
    readonly label: string;
    readonly description: string;
}

export type BuiltinEventCatalogEntry = Omit<EventCatalogEntry, 'name' | 'source'> & {
    readonly name: EventName;
    readonly source: 'builtin';
};

export type EventCatalogEntryInput = {
    readonly name: EventName;
    readonly label?: string;
    readonly description?: string;
    readonly source?: Exclude<EventCatalogSource, 'opaque'>;
    readonly pluginId?: PluginId;
    readonly fields?: readonly EventFieldMetadata[];
};

export type FileEventName = z.infer<typeof FileEventNameSchema>;

export const FILE_EVENT_FIELDS: readonly EventFieldMetadata[] = [
    {
        path: 'path',
        kind: 'string',
        label: 'Path',
        description: 'The full path of the file involved in the Event.',
    },
    {
        path: 'name',
        kind: 'string',
        label: 'Name',
        description: 'The file name, including its extension when present.',
    },
    {
        path: 'ext',
        kind: 'string',
        label: 'Extension',
        description: 'The lowercase file extension without a leading dot.',
    },
    {
        path: 'size',
        kind: 'number',
        label: 'Size',
        description: 'The file size in bytes.',
    },
    {
        path: 'dir',
        kind: 'string',
        label: 'Directory',
        description: 'The directory containing the file.',
    },
];

const FILE_EVENT_DETAILS: Readonly<
    Record<
        (typeof FILE_EVENT_NAMES)[number],
        { readonly label: string; readonly description: string }
    >
> = {
    'file.created': {
        label: 'File created',
        description: 'A file was created in a watched path.',
    },
    'file.modified': {
        label: 'File modified',
        description: 'A file changed in a watched path.',
    },
    'file.deleted': {
        label: 'File deleted',
        description: 'A file was deleted from a watched path.',
    },
};

export const BUILTIN_EVENT_CATALOG: readonly BuiltinEventCatalogEntry[] = FILE_EVENT_NAMES.map(
    (rawName): BuiltinEventCatalogEntry => {
        const name = EventNameSchema.parse(FileEventNameSchema.parse(rawName));
        return {
            name,
            ...FILE_EVENT_DETAILS[rawName],
            source: 'builtin',
            fields: FILE_EVENT_FIELDS,
        };
    },
);

export interface EventCatalog {
    readonly entries: readonly EventCatalogEntry[];
}

function normalizeEntry(input: EventCatalogEntryInput): EventCatalogEntry {
    const parsed = EventCatalogEntrySchema.safeParse({
        name: input.name,
        label: input.label || input.name,
        description: input.description || 'Payload fields are opaque for this Event.',
        source: input.source ?? 'plugin',
        ...(input.pluginId === undefined ? {} : { pluginId: input.pluginId }),
        fields: input.fields ?? [],
    });
    if (parsed.success) return parsed.data;
    throw new Error(`Invalid Event catalog entry: ${parsed.error.message}`);
}

export function createPluginEventCatalogEntries(
    eventNames: readonly EventName[],
    pluginId?: PluginId,
): readonly EventCatalogEntryInput[] {
    return eventNames.map((name) => ({
        name,
        source: 'plugin',
        ...(pluginId === undefined ? {} : { pluginId }),
    }));
}

export function createEventCatalog(
    additionalEntries: readonly EventCatalogEntryInput[] = [],
): EventCatalog {
    const entries = new Map<string, EventCatalogEntry>();
    for (const entry of BUILTIN_EVENT_CATALOG) {
        entries.set(entry.name, entry);
    }
    for (const input of additionalEntries) {
        const entry = normalizeEntry(input);
        if (!entries.has(entry.name)) entries.set(entry.name, entry);
    }
    return { entries: Object.freeze([...entries.values()]) };
}

export function findEvent(
    catalog: EventCatalog,
    eventName: EventName,
): EventCatalogEntry | undefined {
    return catalog.entries.find((entry) => entry.name === eventName);
}

export function opaqueEventCatalogEntry(eventName: EventName): EventCatalogEntry {
    return {
        name: eventName,
        label: eventName,
        description: 'No payload field metadata is available for this Event.',
        source: 'opaque',
        fields: [],
    };
}

export function resolveEvent(catalog: EventCatalog, eventName: EventName): EventCatalogEntry {
    return findEvent(catalog, eventName) ?? opaqueEventCatalogEntry(eventName);
}

export function getEventPayloadFields(
    catalog: EventCatalog,
    eventName?: EventName,
): readonly EventFieldMetadata[] {
    if (eventName !== undefined) return resolveEvent(catalog, eventName).fields;

    const fields = new Map<string, EventFieldMetadata>();
    for (const entry of catalog.entries) {
        for (const field of entry.fields) {
            if (!fields.has(field.path)) fields.set(field.path, field);
        }
    }
    return Object.freeze([...fields.values()]);
}

export function findEventField(
    catalog: EventCatalog,
    fieldPath: string,
    eventName?: EventName,
): EventFieldMetadata | undefined {
    return getEventPayloadFields(catalog, eventName).find((field) => field.path === fieldPath);
}

export function eventCatalogSuggestions(
    catalog: EventCatalog = DEFAULT_EVENT_CATALOG,
): readonly EventCatalogSuggestion<EventName>[] {
    return catalog.entries.map((entry) => ({
        value: entry.name,
        label: entry.label,
        description: entry.description,
    }));
}

export function eventPayloadFieldSuggestions(
    catalog: EventCatalog = DEFAULT_EVENT_CATALOG,
): readonly EventCatalogSuggestion[] {
    return getEventPayloadFields(catalog).map((field) => ({
        value: field.path,
        label: `${field.label} · ${field.kind}`,
        description: field.description,
    }));
}

export const DEFAULT_EVENT_CATALOG = createEventCatalog();
