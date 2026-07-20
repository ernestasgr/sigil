import { z } from 'zod';

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
        name: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1),
        source: EventCatalogSourceSchema,
        pluginId: z.string().min(1).optional(),
        fields: z.array(EventFieldMetadataSchema).readonly(),
    })
    .strict()
    .readonly();
export type EventCatalogEntry = z.infer<typeof EventCatalogEntrySchema>;

export interface EventCatalogSuggestion {
    readonly value: string;
    readonly label: string;
    readonly description: string;
}

export type BuiltinEventCatalogEntry = Omit<EventCatalogEntry, 'name' | 'source'> & {
    readonly name: FileEventName;
    readonly source: 'builtin';
};

export type EventCatalogEntryInput = {
    readonly name: string;
    readonly label?: string;
    readonly description?: string;
    readonly source?: Exclude<EventCatalogSource, 'opaque'>;
    readonly pluginId?: string;
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
    Record<FileEventName, { readonly label: string; readonly description: string }>
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

export const BUILTIN_EVENT_CATALOG: readonly BuiltinEventCatalogEntry[] =
    FileEventNameSchema.options.map(
        (name): BuiltinEventCatalogEntry => ({
            name,
            ...FILE_EVENT_DETAILS[name],
            source: 'builtin',
            fields: FILE_EVENT_FIELDS,
        }),
    );

export interface EventCatalog {
    readonly entries: readonly EventCatalogEntry[];
}

function normalizeEntry(input: EventCatalogEntryInput): EventCatalogEntry | null {
    const name = input.name.trim();
    if (name.length === 0) return null;

    const parsed = EventCatalogEntrySchema.safeParse({
        name,
        label: input.label?.trim() || name,
        description: input.description?.trim() || 'Payload fields are opaque for this Event.',
        source: input.source ?? 'plugin',
        ...(input.pluginId === undefined ? {} : { pluginId: input.pluginId }),
        fields: input.fields ?? [],
    });
    return parsed.success ? parsed.data : null;
}

export function createPluginEventCatalogEntries(
    eventNames: readonly string[],
    pluginId?: string,
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
        if (entry && !entries.has(entry.name)) entries.set(entry.name, entry);
    }
    return { entries: Object.freeze([...entries.values()]) };
}

export function findEvent(catalog: EventCatalog, eventName: string): EventCatalogEntry | undefined {
    return catalog.entries.find((entry) => entry.name === eventName);
}

export function opaqueEventCatalogEntry(eventName: string): EventCatalogEntry {
    const name = eventName.trim();
    return {
        name,
        label: name || 'Opaque Event',
        description: 'No payload field metadata is available for this Event.',
        source: 'opaque',
        fields: [],
    };
}

export function resolveEvent(catalog: EventCatalog, eventName: string): EventCatalogEntry {
    return findEvent(catalog, eventName) ?? opaqueEventCatalogEntry(eventName);
}

export function getEventPayloadFields(
    catalog: EventCatalog,
    eventName?: string,
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
    eventName?: string,
): EventFieldMetadata | undefined {
    return getEventPayloadFields(catalog, eventName).find((field) => field.path === fieldPath);
}

export function eventCatalogSuggestions(
    catalog: EventCatalog = DEFAULT_EVENT_CATALOG,
): readonly EventCatalogSuggestion[] {
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
