import { z } from 'zod';

export const CollisionSuffixStyleSchema = z.enum(['windows', 'underscore', 'hyphen']);
export type CollisionSuffixStyle = z.infer<typeof CollisionSuffixStyleSchema>;

export const ConflictPolicySchema = z.enum(['skip', 'overwrite', 'auto-rename', 'error']);
export type ConflictPolicy = z.infer<typeof ConflictPolicySchema>;

export const DEFAULT_IGNORE_PATTERNS: readonly string[] = Object.freeze([
    '*.crdownload',
    '*.part',
    '*.tmp',
    '*.download',
]);

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
    return Object.freeze({ key, schema, fallback, apply });
}

/**
 * Built-in property descriptors are pure contract data. They are deliberately
 * not registered with a mutable runtime registry while this module loads.
 */
export const BUILTIN_PROPERTY_DESCRIPTORS = Object.freeze({
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
} as const satisfies Readonly<Record<string, PropertyDescriptor<string, z.ZodType>>>);

/** @deprecated Use BUILTIN_PROPERTY_DESCRIPTORS at new call sites. */
export const PROPERTY_DESCRIPTORS = BUILTIN_PROPERTY_DESCRIPTORS;

export type PropertiesKey = keyof typeof BUILTIN_PROPERTY_DESCRIPTORS;

type PropertyValueMap = {
    readonly [K in PropertiesKey]: z.infer<(typeof BUILTIN_PROPERTY_DESCRIPTORS)[K]['schema']>;
};

/** Complete, statically typed settings owned by the built-in contract. */
export type BuiltinProperties = PropertyValueMap;

export type PropertyValue<TKey extends string> = TKey extends PropertiesKey
    ? PropertyValueMap[TKey]
    : unknown;
export type PropertiesFile = Partial<PropertyValueMap> & Readonly<Record<string, unknown>>;
export type ResolvedProperties = PropertyValueMap;
export type RegisteredResolvedProperties = ResolvedProperties & Readonly<Record<string, unknown>>;

/** Raw candidates are validated by the Engine-owned registry before use. */
export interface PropertyResolutionSources {
    readonly explicit?: unknown;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly fallback?: unknown;
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

/** Static contract validation for the built-in Properties File shape. */
export const PropertiesFileSchema = z
    .object({
        notifyOnWorkflowError: BUILTIN_PROPERTY_DESCRIPTORS.notifyOnWorkflowError.schema.optional(),
        databasePath: BUILTIN_PROPERTY_DESCRIPTORS.databasePath.schema.optional(),
        collisionSuffixStyle: BUILTIN_PROPERTY_DESCRIPTORS.collisionSuffixStyle.schema.optional(),
        'file-watcher.ignorePatterns':
            BUILTIN_PROPERTY_DESCRIPTORS['file-watcher.ignorePatterns'].schema.optional(),
        'file-manager.defaultOnConflict':
            BUILTIN_PROPERTY_DESCRIPTORS['file-manager.defaultOnConflict'].schema.optional(),
        'file-manager.collisionSuffixStyle':
            BUILTIN_PROPERTY_DESCRIPTORS['file-manager.collisionSuffixStyle'].schema.optional(),
    })
    .strict() as z.ZodType<PropertiesFile>;

/** Immutable built-in defaults; dynamic Plugin defaults live in the Engine registry. */
export const BUILTIN_PROPERTY_DEFAULTS: Readonly<ResolvedProperties> = Object.freeze({
    notifyOnWorkflowError: BUILTIN_PROPERTY_DESCRIPTORS.notifyOnWorkflowError.fallback,
    databasePath: BUILTIN_PROPERTY_DESCRIPTORS.databasePath.fallback,
    collisionSuffixStyle: BUILTIN_PROPERTY_DESCRIPTORS.collisionSuffixStyle.fallback,
    'file-watcher.ignorePatterns':
        BUILTIN_PROPERTY_DESCRIPTORS['file-watcher.ignorePatterns'].fallback,
    'file-manager.defaultOnConflict':
        BUILTIN_PROPERTY_DESCRIPTORS['file-manager.defaultOnConflict'].fallback,
    'file-manager.collisionSuffixStyle':
        BUILTIN_PROPERTY_DESCRIPTORS['file-manager.collisionSuffixStyle'].fallback,
});

/** @deprecated Use BUILTIN_PROPERTY_DEFAULTS at new call sites. */
export const DEFAULT_PROPERTIES = BUILTIN_PROPERTY_DEFAULTS;
