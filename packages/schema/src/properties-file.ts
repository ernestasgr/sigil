import { z } from 'zod';

export const CollisionSuffixStyleSchema = z.enum(['windows', 'underscore', 'hyphen']);
export type CollisionSuffixStyle = z.infer<typeof CollisionSuffixStyleSchema>;

export const ConflictPolicySchema = z.enum(['skip', 'overwrite', 'auto-rename', 'error']);
export type ConflictPolicy = z.infer<typeof ConflictPolicySchema>;

export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
    '*.crdownload',
    '*.part',
    '*.tmp',
    '*.download',
];

export interface PropertyDescriptor<TKey extends string, TSchema extends z.ZodType> {
    readonly key: TKey;
    readonly schema: TSchema;
    readonly fallback: z.output<TSchema>;
}

export function definePropertyDescriptor<TKey extends string, TSchema extends z.ZodType>(
    key: TKey,
    schema: TSchema,
    fallback: z.output<TSchema>,
): PropertyDescriptor<TKey, TSchema> {
    return { key, schema, fallback };
}

export const PROPERTY_DESCRIPTORS = {
    notifyOnWorkflowError: definePropertyDescriptor('notifyOnWorkflowError', z.boolean(), true),
    databasePath: definePropertyDescriptor('databasePath', z.string(), ':memory:'),
    collisionSuffixStyle: definePropertyDescriptor(
        'collisionSuffixStyle',
        CollisionSuffixStyleSchema,
        'windows',
    ),
    'file-watcher.ignorePatterns': definePropertyDescriptor(
        'file-watcher.ignorePatterns',
        z.array(z.string()).readonly(),
        DEFAULT_IGNORE_PATTERNS,
    ),
    'file-manager.defaultOnConflict': definePropertyDescriptor(
        'file-manager.defaultOnConflict',
        ConflictPolicySchema,
        'error',
    ),
    'file-manager.collisionSuffixStyle': definePropertyDescriptor(
        'file-manager.collisionSuffixStyle',
        CollisionSuffixStyleSchema,
        'windows',
    ),
} as const satisfies Readonly<Record<string, PropertyDescriptor<string, z.ZodType>>>;

export type PropertiesKey = keyof typeof PROPERTY_DESCRIPTORS;

type PropertyValueMap = {
    readonly [K in PropertiesKey]: z.infer<(typeof PROPERTY_DESCRIPTORS)[K]['schema']>;
};

export type PropertyValue<TKey extends PropertiesKey> = TKey extends PropertiesKey
    ? PropertyValueMap[TKey]
    : never;

type PropertiesFileShape = {
    readonly [K in PropertiesKey]: z.ZodOptional<(typeof PROPERTY_DESCRIPTORS)[K]['schema']>;
};

function createPropertiesFileSchema(): z.ZodObject<PropertiesFileShape> {
    const shape = Object.fromEntries(
        Object.entries(PROPERTY_DESCRIPTORS).map(([key, descriptor]) => [
            key,
            descriptor.schema.optional(),
        ]),
    ) as PropertiesFileShape;
    return z.object(shape).strict();
}

export const PropertiesFileSchema = createPropertiesFileSchema();
export type PropertiesFile = z.infer<typeof PropertiesFileSchema> & Partial<PropertyValueMap>;

export type ResolvedProperties = PropertyValueMap;

export interface PropertyResolutionSources<TKey extends PropertiesKey> {
    readonly explicit?: PropertyValue<TKey>;
    readonly properties: PropertiesFile;
    readonly fallback?: PropertyValue<TKey>;
}

export function resolve<TKey extends PropertiesKey>(
    key: TKey,
    sources: PropertyResolutionSources<TKey>,
): PropertyValue<TKey> {
    const propertyValue = sources.properties[key];
    if (sources.explicit !== undefined) return sources.explicit;
    // TypeScript widens a heterogeneous mapped-object lookup to a union here;
    // the key generic still preserves the correlation at the public seam.
    if (propertyValue !== undefined) return propertyValue as PropertyValue<TKey>;
    if (sources.fallback !== undefined) return sources.fallback;
    return PROPERTY_DESCRIPTORS[key].fallback as PropertyValue<TKey>;
}

export function resolveAll(
    properties: PropertiesFile,
    fallbacks: Partial<ResolvedProperties> = {},
): ResolvedProperties {
    const keys = Object.keys(PROPERTY_DESCRIPTORS) as PropertiesKey[];
    const entries = keys.map((key) => [
        key,
        resolve(key, { properties, fallback: fallbacks[key] }),
    ]);
    return Object.fromEntries(entries) as ResolvedProperties;
}

export const DEFAULT_PROPERTIES: Readonly<ResolvedProperties> = resolveAll({});

export type PropertiesFileLoadResult =
    | {
          readonly ok: true;
          readonly value: ResolvedProperties;
          readonly properties: PropertiesFile;
      }
    | { readonly ok: false; readonly error: string };

export function loadPropertiesFile(
    unknown: unknown,
    defaults: Partial<ResolvedProperties> = {},
): PropertiesFileLoadResult {
    const result = PropertiesFileSchema.safeParse(unknown);
    if (!result.success) {
        return {
            ok: false,
            error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        };
    }
    return {
        ok: true,
        value: resolveAll(result.data, defaults),
        properties: result.data,
    };
}
