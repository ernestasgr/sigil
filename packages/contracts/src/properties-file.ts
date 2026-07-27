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

export const PropertyApplyModeSchema = z.enum(['hot', 'restart-required']);
export type PropertyApplyMode = z.infer<typeof PropertyApplyModeSchema>;

export interface PropertyDescriptor<
    TKey extends string = string,
    TSchema extends z.ZodType = z.ZodType,
> {
    readonly key: TKey;
    readonly schema: TSchema;
    readonly fallback: z.output<TSchema>;
    readonly apply: PropertyApplyMode;
}

export type AnyPropertyDescriptor = PropertyDescriptor<string, z.ZodType>;
export type PropertySchemaJson = boolean | Readonly<Record<string, unknown>>;

export interface SerializedPropertyDescriptor {
    readonly key: string;
    readonly schema: PropertySchemaJson;
    readonly fallback: unknown;
    readonly apply: PropertyApplyMode;
}

function isJsonSafe(value: unknown, seen = new Set<object>()): boolean {
    if (value === null) return true;

    switch (typeof value) {
        case 'string':
        case 'boolean':
            return true;
        case 'number':
            return Number.isFinite(value);
        case 'object':
            if (seen.has(value)) return false;
            seen.add(value);
            try {
                if (Array.isArray(value)) return value.every((item) => isJsonSafe(item, seen));
                const prototype = Object.getPrototypeOf(value);
                const record = value as Record<string, unknown>;
                return (
                    (prototype === Object.prototype || prototype === null) &&
                    Object.keys(record).every((key) => isJsonSafe(record[key], seen))
                );
            } catch {
                return false;
            } finally {
                seen.delete(value);
            }
        default:
            return false;
    }
}

const JsonSafeFallbackSchema = z.unknown().refine((value) => isJsonSafe(value), {
    message: 'Property descriptor fallback must be JSON-safe.',
});

export const SerializedPropertyDescriptorSchema = z
    .object({
        key: z
            .string()
            .min(1)
            .refine((key) => key !== '__proto__', {
                message: 'Property descriptor key "__proto__" is reserved.',
            }),
        schema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
        fallback: JsonSafeFallbackSchema,
        apply: PropertyApplyModeSchema,
    })
    .strict();

export function definePropertyDescriptor<TKey extends string, TSchema extends z.ZodType>(
    key: TKey,
    schema: TSchema,
    fallback: z.output<TSchema>,
    apply: PropertyApplyMode,
): PropertyDescriptor<TKey, TSchema> {
    return { key, schema, fallback, apply };
}

export const PROPERTY_DESCRIPTORS = {
    notifyOnWorkflowError: definePropertyDescriptor(
        'notifyOnWorkflowError',
        z.boolean(),
        true,
        'hot',
    ),
    databasePath: definePropertyDescriptor(
        'databasePath',
        z.string(),
        ':memory:',
        'restart-required',
    ),
    collisionSuffixStyle: definePropertyDescriptor(
        'collisionSuffixStyle',
        CollisionSuffixStyleSchema,
        'windows',
        'hot',
    ),
    'file-watcher.ignorePatterns': definePropertyDescriptor(
        'file-watcher.ignorePatterns',
        z.array(z.string()).readonly(),
        DEFAULT_IGNORE_PATTERNS,
        'hot',
    ),
    'file-manager.defaultOnConflict': definePropertyDescriptor(
        'file-manager.defaultOnConflict',
        ConflictPolicySchema,
        'error',
        'hot',
    ),
    'file-manager.collisionSuffixStyle': definePropertyDescriptor(
        'file-manager.collisionSuffixStyle',
        CollisionSuffixStyleSchema,
        'windows',
        'hot',
    ),
} as const satisfies Readonly<Record<string, PropertyDescriptor<string, z.ZodType>>>;

export type PropertiesKey = keyof typeof PROPERTY_DESCRIPTORS;

type PropertyValueMap = {
    readonly [K in PropertiesKey]: z.infer<(typeof PROPERTY_DESCRIPTORS)[K]['schema']>;
};

export type PropertyValue<TKey extends string> = TKey extends PropertiesKey
    ? PropertyValueMap[TKey]
    : unknown;
export type PropertiesFile = Partial<PropertyValueMap> & Readonly<Record<string, unknown>>;
export type ResolvedProperties = PropertyValueMap;
export type RegisteredResolvedProperties = ResolvedProperties & Readonly<Record<string, unknown>>;

export interface PropertyResolutionSources<TKey extends string> {
    readonly explicit?: PropertyValue<TKey>;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly fallback?: PropertyValue<TKey>;
}

export function serializePropertyDescriptor(
    descriptor: AnyPropertyDescriptor,
): SerializedPropertyDescriptor {
    const fallback = descriptor.schema.safeParse(descriptor.fallback);
    if (!fallback.success) {
        throw new Error(
            `Fallback for property "${descriptor.key}" does not match its schema: ${fallback.error.message}`,
        );
    }
    if (!isJsonSafe(fallback.data)) {
        throw new Error(`Fallback for property "${descriptor.key}" must be JSON-safe.`);
    }
    const apply = PropertyApplyModeSchema.safeParse(descriptor.apply);
    if (!apply.success) {
        throw new Error(
            `Property "${descriptor.key}" must declare an apply mode of "hot" or "restart-required".`,
        );
    }
    return {
        key: descriptor.key,
        schema: z.toJSONSchema(descriptor.schema),
        fallback: fallback.data,
        apply: apply.data,
    };
}

const builtinShape: Record<string, z.ZodType> = {};
for (const [key, descriptor] of Object.entries(PROPERTY_DESCRIPTORS)) {
    builtinShape[key] = descriptor.schema.optional();
}

/** Static contract validation for the built-in Properties File shape. */
export const PropertiesFileSchema = z.object(builtinShape).strict() as z.ZodType<PropertiesFile>;

export const DEFAULT_PROPERTIES: Readonly<RegisteredResolvedProperties> = Object.freeze(
    Object.fromEntries(
        Object.entries(PROPERTY_DESCRIPTORS).map(([key, descriptor]) => [key, descriptor.fallback]),
    ) as RegisteredResolvedProperties,
);
