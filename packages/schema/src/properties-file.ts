import { fromJSONSchema, z } from 'zod';

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

export interface PropertyDescriptor<
    TKey extends string = string,
    TSchema extends z.ZodType = z.ZodType,
> {
    readonly key: TKey;
    readonly schema: TSchema;
    readonly fallback: z.output<TSchema>;
}

export type AnyPropertyDescriptor = PropertyDescriptor<string, z.ZodType>;
export type PropertySchemaJson = boolean | Readonly<Record<string, unknown>>;

export interface SerializedPropertyDescriptor {
    readonly key: string;
    readonly schema: PropertySchemaJson;
    readonly fallback: unknown;
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
                if (Array.isArray(value)) {
                    return value.every((item) => isJsonSafe(item, seen));
                }
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
    })
    .strict();

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

export interface PropertyRegistryOptions {
    readonly owner?: string;
    /**
     * Builtin Plugins are loaded after the compatibility registry has seeded
     * their descriptors. They may re-submit the exact descriptor; arbitrary
     * Plugins may not use this escape hatch.
     */
    readonly allowExisting?: boolean;
}

export type PropertyRegistryError =
    | {
          readonly kind: 'invalid_descriptor';
          readonly key?: string;
          readonly message: string;
      }
    | {
          readonly kind: 'duplicate';
          readonly key: string;
      };

export type PropertyRegistrationResult =
    | {
          readonly ok: true;
          readonly descriptor: AnyPropertyDescriptor;
          readonly registered: boolean;
      }
    | { readonly ok: false; readonly error: PropertyRegistryError };

export type PropertyRegistrationBatchResult =
    | {
          readonly ok: true;
          readonly descriptors: readonly AnyPropertyDescriptor[];
          readonly registeredKeys: readonly string[];
      }
    | { readonly ok: false; readonly error: PropertyRegistryError };

export interface PropertyRegistry {
    readonly register: (
        descriptor: PropertyDescriptor<string, z.ZodType> | SerializedPropertyDescriptor,
        options?: PropertyRegistryOptions,
    ) => PropertyRegistrationResult;
    readonly registerMany: (
        descriptors: readonly (
            | PropertyDescriptor<string, z.ZodType>
            | SerializedPropertyDescriptor
        )[],
        options?: PropertyRegistryOptions,
    ) => PropertyRegistrationBatchResult;
    readonly unregister: (key: string) => void;
    readonly unregisterOwner: (owner: string) => void;
    readonly get: (key: string) => AnyPropertyDescriptor | undefined;
    readonly has: (key: string) => boolean;
    readonly all: () => readonly AnyPropertyDescriptor[];
    readonly schema: () => z.ZodType<PropertiesFile>;
    readonly resolve: <TKey extends string>(
        key: TKey,
        sources: PropertyResolutionSources<TKey>,
    ) => PropertyValue<TKey>;
    readonly resolveAll: (
        properties: Readonly<Record<string, unknown>>,
        fallbacks?: Readonly<Record<string, unknown>>,
    ) => RegisteredResolvedProperties;
    readonly defaults: () => Readonly<RegisteredResolvedProperties>;
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

    return {
        key: descriptor.key,
        schema: z.toJSONSchema(descriptor.schema),
        fallback: fallback.data,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isZodSchema(value: unknown): value is z.ZodType {
    return isRecord(value) && typeof value.safeParse === 'function';
}

function invalidDescriptor(
    message: string,
    key?: string,
): { readonly ok: false; readonly error: PropertyRegistryError } {
    return { ok: false, error: { kind: 'invalid_descriptor', key, message } };
}

function normalizeDescriptor(
    input: PropertyDescriptor<string, z.ZodType> | SerializedPropertyDescriptor,
):
    | { readonly ok: true; readonly descriptor: AnyPropertyDescriptor }
    | { readonly ok: false; readonly error: PropertyRegistryError } {
    if (!isRecord(input) || typeof input.key !== 'string' || input.key.length === 0) {
        return invalidDescriptor('Property descriptor key must be a non-empty string.');
    }

    const key = input.key;
    if (key === '__proto__') {
        return invalidDescriptor('Property descriptor key "__proto__" is reserved.', key);
    }

    let schema: z.ZodType;
    if (isZodSchema(input.schema)) {
        schema = input.schema;
    } else {
        const serializedSchema = z
            .union([z.boolean(), z.record(z.string(), z.unknown())])
            .safeParse(input.schema);
        if (!serializedSchema.success) {
            return invalidDescriptor(
                'Property descriptor schema must be a Zod schema or JSON Schema.',
                key,
            );
        }
        try {
            schema = fromJSONSchema(serializedSchema.data);
        } catch (error) {
            return invalidDescriptor(
                `Property descriptor schema could not be reconstructed: ${error instanceof Error ? error.message : String(error)}`,
                key,
            );
        }
    }

    const fallback = schema.safeParse(input.fallback);
    if (!fallback.success) {
        return invalidDescriptor(
            `Property descriptor fallback does not match its schema: ${fallback.error.message}`,
            key,
        );
    }
    if (fallback.data === undefined) {
        return invalidDescriptor('Property descriptor fallback must be defined.', key);
    }
    if (!isJsonSafe(fallback.data)) {
        return invalidDescriptor('Property descriptor fallback must be JSON-safe.', key);
    }

    return {
        ok: true,
        descriptor: {
            key,
            schema,
            fallback: fallback.data,
        },
    };
}

function schemaFingerprint(schema: z.ZodType): string | undefined {
    try {
        return JSON.stringify(z.toJSONSchema(schema));
    } catch {
        return undefined;
    }
}

function descriptorsMatch(first: AnyPropertyDescriptor, second: AnyPropertyDescriptor): boolean {
    const firstSchema = schemaFingerprint(first.schema);
    const secondSchema = schemaFingerprint(second.schema);
    if (firstSchema === undefined || firstSchema !== secondSchema) return false;

    try {
        return JSON.stringify(first.fallback) === JSON.stringify(second.fallback);
    } catch {
        return false;
    }
}

function createPropertiesFileSchema(
    descriptors: ReadonlyMap<string, { readonly descriptor: AnyPropertyDescriptor }>,
): z.ZodType<PropertiesFile> {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, entry] of descriptors) {
        shape[key] = entry.descriptor.schema.optional();
    }
    // The registry is the runtime trust boundary. Its keys are validated by
    // normalizeDescriptor before they enter this dynamic Zod object.
    return z.object(shape).strict() as z.ZodType<PropertiesFile>;
}

export function createPropertyRegistry(
    initialDescriptors: readonly AnyPropertyDescriptor[] = Object.values(PROPERTY_DESCRIPTORS),
): PropertyRegistry {
    const descriptors = new Map<
        string,
        { readonly descriptor: AnyPropertyDescriptor; readonly owner?: string }
    >();

    for (const descriptor of initialDescriptors) {
        const normalized = normalizeDescriptor(descriptor);
        if (!normalized.ok) {
            throw new Error(
                normalized.error.kind === 'invalid_descriptor'
                    ? normalized.error.message
                    : `Duplicate property "${normalized.error.key}".`,
            );
        }
        if (descriptors.has(normalized.descriptor.key)) {
            throw new Error(`Duplicate property "${normalized.descriptor.key}".`);
        }
        descriptors.set(normalized.descriptor.key, { descriptor: normalized.descriptor });
    }

    let propertiesFileSchema = createPropertiesFileSchema(descriptors);

    const register = (
        input: PropertyDescriptor<string, z.ZodType> | SerializedPropertyDescriptor,
        options: PropertyRegistryOptions = {},
    ): PropertyRegistrationResult => {
        const normalized = normalizeDescriptor(input);
        if (!normalized.ok) return normalized;

        const existing = descriptors.get(normalized.descriptor.key);
        if (existing) {
            if (
                options.allowExisting &&
                descriptorsMatch(existing.descriptor, normalized.descriptor)
            ) {
                return {
                    ok: true,
                    descriptor: existing.descriptor,
                    registered: false,
                };
            }
            return {
                ok: false,
                error: { kind: 'duplicate', key: normalized.descriptor.key },
            };
        }

        descriptors.set(normalized.descriptor.key, {
            descriptor: normalized.descriptor,
            ...(options.owner === undefined ? {} : { owner: options.owner }),
        });
        propertiesFileSchema = createPropertiesFileSchema(descriptors);
        return { ok: true, descriptor: normalized.descriptor, registered: true };
    };

    const registerMany = (
        inputs: readonly (PropertyDescriptor<string, z.ZodType> | SerializedPropertyDescriptor)[],
        options: PropertyRegistryOptions = {},
    ): PropertyRegistrationBatchResult => {
        const seen = new Set<string>();
        const registeredKeys: string[] = [];
        const normalizedDescriptors: AnyPropertyDescriptor[] = [];

        const rollback = (): void => {
            if (registeredKeys.length === 0) return;
            for (const key of registeredKeys) descriptors.delete(key);
            propertiesFileSchema = createPropertiesFileSchema(descriptors);
        };

        for (const input of inputs) {
            const normalized = normalizeDescriptor(input);
            if (!normalized.ok) {
                rollback();
                return normalized;
            }

            if (seen.has(normalized.descriptor.key)) {
                rollback();
                return {
                    ok: false,
                    error: { kind: 'duplicate', key: normalized.descriptor.key },
                };
            }
            seen.add(normalized.descriptor.key);

            const result = register(normalized.descriptor, options);
            if (!result.ok) {
                rollback();
                return result;
            }

            normalizedDescriptors.push(result.descriptor);
            if (result.registered) registeredKeys.push(result.descriptor.key);
        }

        return { ok: true, descriptors: normalizedDescriptors, registeredKeys };
    };

    return {
        register,
        registerMany,
        unregister: (key) => {
            if (!descriptors.delete(key)) return;
            propertiesFileSchema = createPropertiesFileSchema(descriptors);
        },
        unregisterOwner: (owner) => {
            let changed = false;
            for (const [key, entry] of descriptors) {
                if (entry.owner === owner) {
                    descriptors.delete(key);
                    changed = true;
                }
            }
            if (changed) propertiesFileSchema = createPropertiesFileSchema(descriptors);
        },
        get: (key) => descriptors.get(key)?.descriptor,
        has: (key) => descriptors.has(key),
        all: () => [...descriptors.values()].map((entry) => entry.descriptor),
        schema: () => propertiesFileSchema,
        resolve: <TKey extends string>(
            key: TKey,
            sources: PropertyResolutionSources<TKey>,
        ): PropertyValue<TKey> => {
            const descriptor = descriptors.get(key)?.descriptor;
            if (!descriptor) return undefined as PropertyValue<TKey>;
            if (sources.explicit !== undefined) return sources.explicit;
            const propertyValue = sources.properties[key];
            if (propertyValue !== undefined) return propertyValue as PropertyValue<TKey>;
            if (sources.fallback !== undefined) return sources.fallback;
            return descriptor.fallback as PropertyValue<TKey>;
        },
        resolveAll: (properties, fallbacks = {}) => {
            const entries = [...descriptors.entries()].map(
                ([key, entry]) =>
                    [key, sourcesValue(entry.descriptor, properties, fallbacks[key])] as const,
            );
            return Object.fromEntries(entries) as RegisteredResolvedProperties;
        },
        defaults: () => {
            const entries = [...descriptors.entries()].map(
                ([key, entry]) => [key, entry.descriptor.fallback] as const,
            );
            return Object.fromEntries(entries) as RegisteredResolvedProperties;
        },
    };
}

function sourcesValue(
    descriptor: AnyPropertyDescriptor,
    properties: Readonly<Record<string, unknown>>,
    fallback: unknown,
): unknown {
    const propertyValue = properties[descriptor.key];
    if (propertyValue !== undefined) return propertyValue;
    if (fallback !== undefined) return fallback;
    return descriptor.fallback;
}

const defaultPropertyRegistry = createPropertyRegistry();

export const PROPERTY_REGISTRY = defaultPropertyRegistry;

export function registerPropertyDescriptor(
    descriptor: PropertyDescriptor<string, z.ZodType> | SerializedPropertyDescriptor,
    options?: PropertyRegistryOptions,
): PropertyRegistrationResult {
    return defaultPropertyRegistry.register(descriptor, options);
}

export const PropertiesFileSchema = z.unknown().transform((value, context) => {
    const result = defaultPropertyRegistry.schema().safeParse(value);
    if (!result.success) {
        for (const issue of result.error.issues) {
            // Zod's transform context uses a narrower issue input type than
            // the issue union produced by another Zod schema.
            context.addIssue(issue as Parameters<typeof context.addIssue>[0]);
        }
        return z.NEVER;
    }
    return result.data;
}) as z.ZodType<PropertiesFile>;

export function resolve<TKey extends PropertiesKey>(
    key: TKey,
    sources: PropertyResolutionSources<TKey>,
): PropertyValue<TKey> {
    return defaultPropertyRegistry.resolve(key, sources) as PropertyValue<TKey>;
}

export function resolveAll(
    properties: PropertiesFile,
    fallbacks: Partial<ResolvedProperties> = {},
): ResolvedProperties {
    return defaultPropertyRegistry.resolveAll(properties, fallbacks);
}

export const DEFAULT_PROPERTIES: Readonly<RegisteredResolvedProperties> =
    defaultPropertyRegistry.defaults();

export type PropertiesFileLoadResult =
    | {
          readonly ok: true;
          readonly value: RegisteredResolvedProperties;
          readonly properties: PropertiesFile;
      }
    | { readonly ok: false; readonly error: string };

export function loadPropertiesFile(
    unknown: unknown,
    defaults: Readonly<Record<string, unknown>> = {},
    registry: PropertyRegistry = defaultPropertyRegistry,
): PropertiesFileLoadResult {
    const result = registry.schema().safeParse(unknown);
    if (!result.success) {
        return {
            ok: false,
            error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        };
    }
    return {
        ok: true,
        value: registry.resolveAll(result.data, defaults),
        properties: result.data,
    };
}
