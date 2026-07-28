import type {
    AnyPropertyDescriptor,
    CollisionSuffixStyle,
    ConflictPolicy,
    PropertiesFile,
    PropertiesKey,
    PropertyApplyMode,
    PropertyDescriptor,
    PropertyResolutionSources,
    PropertySchemaJson,
    PropertyValue,
    RegisteredResolvedProperties,
    ResolvedProperties,
    SerializedPropertyDescriptor,
} from '@sigil/contracts/properties-file';

import {
    BUILTIN_PROPERTY_DESCRIPTORS,
    PropertyApplyModeSchema,
} from '@sigil/contracts/properties-file';
import { fromJSONSchema, z } from 'zod';
import { cloneSnapshot, freezeSnapshot } from '../../shared/property-snapshot.js';

export {
    BUILTIN_PROPERTY_DESCRIPTORS,
    DEFAULT_PROPERTIES,
    PROPERTY_DESCRIPTORS,
} from '@sigil/contracts/properties-file';
export type {
    AnyPropertyDescriptor,
    CollisionSuffixStyle,
    ConflictPolicy,
    PropertiesFile,
    PropertiesKey,
    PropertyApplyMode,
    PropertyDescriptor,
    PropertyResolutionSources,
    PropertySchemaJson,
    PropertyValue,
    RegisteredResolvedProperties,
    ResolvedProperties,
    SerializedPropertyDescriptor,
};

export interface PropertyRegistryOptions {
    readonly owner?: string;
    /**
     * Built-in Plugins may re-submit the immutable descriptor seeded by the
     * Engine. Arbitrary duplicate descriptors never use this escape hatch.
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

export type PropertyResolutionSource =
    | 'explicit'
    | 'properties-file'
    | 'caller-fallback'
    | 'descriptor-fallback';

export type PropertyResolutionResult<TValue> =
    | {
          readonly ok: true;
          readonly kind: 'success';
          readonly status: 'success';
          readonly value: TValue;
          readonly source: PropertyResolutionSource;
      }
    | {
          readonly ok: false;
          readonly kind: 'missing';
          readonly status: 'missing';
          readonly key: string;
      }
    | {
          readonly ok: false;
          readonly kind: 'invalid';
          readonly status: 'invalid';
          readonly key: string;
          readonly source: PropertyResolutionSource;
          readonly error: string;
          readonly issues: readonly string[];
      };

export type PropertyResolutionBatchResult =
    | { readonly ok: true; readonly value: RegisteredResolvedProperties }
    | {
          readonly ok: false;
          readonly error: Extract<PropertyResolutionResult<unknown>, { readonly ok: false }>;
      };

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
    /** Remove a non-built-in descriptor by key. */
    readonly unregister: (key: string) => boolean;
    /** Remove all descriptors owned by one Plugin and return the removed keys. */
    readonly unregisterOwner: (owner: string) => readonly string[];
    /** Return an immutable descriptor snapshot. */
    readonly get: (key: string) => AnyPropertyDescriptor | undefined;
    readonly has: (key: string) => boolean;
    /** Return immutable descriptor snapshots in registration order. */
    readonly all: () => readonly AnyPropertyDescriptor[];
    /** Return a schema refreshed after every successful registration change. */
    readonly schema: () => z.ZodType<PropertiesFile>;
    /**
     * Resolve the first selected source and validate that winner. A dynamic
     * key therefore cannot hide missing or invalid data behind a concrete type.
     */
    readonly resolve: <TKey extends string>(
        key: TKey,
        sources: PropertyResolutionSources,
    ) => PropertyResolutionResult<PropertyValue<TKey>>;
    readonly resolveAll: (
        properties: Readonly<Record<string, unknown>>,
        fallbacks?: Readonly<Record<string, unknown>>,
    ) => PropertyResolutionBatchResult;
    /** Return an immutable snapshot of every currently registered fallback. */
    readonly defaults: () => Readonly<RegisteredResolvedProperties>;
}

interface StoredDescriptor {
    readonly descriptor: AnyPropertyDescriptor;
    readonly owner?: string;
    readonly builtin: boolean;
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

    let fallback: ReturnType<typeof schema.safeParse>;
    try {
        fallback = schema.safeParse(input.fallback);
    } catch (error) {
        return invalidDescriptor(
            `Property descriptor fallback could not be validated: ${error instanceof Error ? error.message : String(error)}`,
            key,
        );
    }
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

    const apply = PropertyApplyModeSchema.safeParse(input.apply);
    if (!apply.success) {
        return invalidDescriptor(
            'Property descriptor must explicitly declare an apply mode of "hot" or "restart-required".',
            key,
        );
    }

    return {
        ok: true,
        descriptor: Object.freeze({
            key,
            schema,
            fallback: cloneSnapshot(fallback.data),
            apply: apply.data,
        }),
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
    if (first.apply !== second.apply) return false;
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
    descriptors: ReadonlyMap<string, StoredDescriptor>,
): z.ZodType<PropertiesFile> {
    const shape = Object.fromEntries(
        [...descriptors.entries()].map(([key, entry]) => [key, entry.descriptor.schema.optional()]),
    );
    return z.object(shape).strict() as z.ZodType<PropertiesFile>;
}

function formatIssues(issues: readonly string[]): string {
    return issues.join('\n');
}

function invalidPropertyResult(
    key: string,
    source: PropertyResolutionSource,
    error: string,
    issues: readonly string[] = [error],
): PropertyResolutionResult<never> {
    return {
        ok: false,
        kind: 'invalid',
        status: 'invalid',
        key,
        source,
        error,
        issues,
    };
}

export function propertyResolutionError(
    result: Extract<PropertyResolutionResult<unknown>, { readonly ok: false }>,
): string {
    return result.kind === 'missing'
        ? `Property "${result.key}" is not registered.`
        : `Property "${result.key}" from ${result.source} is invalid: ${result.error}`;
}

/** Create the mutable registry owned by one Engine composition root. */
export function createPropertyRegistry(
    initialDescriptors: readonly AnyPropertyDescriptor[] = Object.values(
        BUILTIN_PROPERTY_DESCRIPTORS,
    ),
): PropertyRegistry {
    const descriptors = new Map<string, StoredDescriptor>();

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
        descriptors.set(normalized.descriptor.key, {
            descriptor: normalized.descriptor,
            builtin: Object.hasOwn(BUILTIN_PROPERTY_DESCRIPTORS, normalized.descriptor.key),
        });
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
                    descriptor: cloneDescriptor(existing.descriptor),
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
            builtin: false,
        });
        propertiesFileSchema = createPropertiesFileSchema(descriptors);
        return {
            ok: true,
            descriptor: cloneDescriptor(normalized.descriptor),
            registered: true,
        };
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

    const resolve = <TKey extends string>(
        key: TKey,
        sources: PropertyResolutionSources,
    ): PropertyResolutionResult<PropertyValue<TKey>> => {
        const entry = descriptors.get(key);
        if (!entry) {
            return { ok: false, kind: 'missing', status: 'missing', key };
        }

        let source: PropertyResolutionSource;
        let candidate: unknown;
        if (sources.explicit !== undefined) {
            source = 'explicit';
            candidate = sources.explicit;
        } else if (Object.hasOwn(sources.properties, key)) {
            source = 'properties-file';
            candidate = sources.properties[key];
        } else if (sources.fallback !== undefined) {
            source = 'caller-fallback';
            candidate = sources.fallback;
        } else {
            source = 'descriptor-fallback';
            candidate = entry.descriptor.fallback;
        }

        try {
            const parsed = entry.descriptor.schema.safeParse(candidate);
            if (!parsed.success) {
                const issues = parsed.error.issues.map((issue) => {
                    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
                    return `${path}: ${issue.message}`;
                });
                return invalidPropertyResult(key, source, formatIssues(issues), issues);
            }
            return {
                ok: true,
                kind: 'success',
                status: 'success',
                value: cloneSnapshot(parsed.data) as PropertyValue<TKey>,
                source,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return invalidPropertyResult(key, source, message);
        }
    };

    const resolveAll = (
        properties: Readonly<Record<string, unknown>>,
        fallbacks: Readonly<Record<string, unknown>> = {},
    ): PropertyResolutionBatchResult => {
        const resolved: Record<string, unknown> = {};
        for (const key of descriptors.keys()) {
            const result = resolve(key, { properties, fallback: fallbacks[key] });
            if (!result.ok) return { ok: false, error: result };
            resolved[key] = result.value;
        }
        return {
            ok: true,
            value: freezeSnapshot(resolved) as RegisteredResolvedProperties,
        };
    };

    return {
        register,
        registerMany,
        unregister: (key) => {
            const entry = descriptors.get(key);
            if (!entry || entry.builtin) return false;
            descriptors.delete(key);
            propertiesFileSchema = createPropertiesFileSchema(descriptors);
            return true;
        },
        unregisterOwner: (owner) => {
            const removed: string[] = [];
            for (const [key, entry] of descriptors) {
                if (entry.owner === owner) {
                    descriptors.delete(key);
                    removed.push(key);
                }
            }
            if (removed.length > 0) {
                propertiesFileSchema = createPropertiesFileSchema(descriptors);
            }
            return Object.freeze(removed);
        },
        get: (key) => {
            const descriptor = descriptors.get(key)?.descriptor;
            return descriptor === undefined ? undefined : cloneDescriptor(descriptor);
        },
        has: (key) => descriptors.has(key),
        all: () =>
            Object.freeze(
                [...descriptors.values()].map((entry) => cloneDescriptor(entry.descriptor)),
            ),
        schema: () => propertiesFileSchema,
        resolve,
        resolveAll,
        defaults: () => {
            const defaults: Record<string, unknown> = {};
            for (const [key, entry] of descriptors) {
                defaults[key] = entry.descriptor.fallback;
            }
            return cloneSnapshot(defaults) as Readonly<RegisteredResolvedProperties>;
        },
    };
}

function cloneDescriptor(descriptor: AnyPropertyDescriptor): AnyPropertyDescriptor {
    return Object.freeze({
        ...descriptor,
        fallback: cloneSnapshot(descriptor.fallback),
    });
}

export type PropertiesFileLoadResult =
    | {
          readonly ok: true;
          readonly value: RegisteredResolvedProperties;
          readonly properties: PropertiesFile;
      }
    | { readonly ok: false; readonly error: string };

export function loadPropertiesFile(
    unknown: unknown,
    registry: PropertyRegistry,
    defaults: Readonly<Record<string, unknown>> = {},
): PropertiesFileLoadResult {
    const result = registry.schema().safeParse(unknown);
    if (!result.success) {
        return {
            ok: false,
            error: result.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('\n'),
        };
    }

    const resolved = registry.resolveAll(result.data, defaults);
    if (!resolved.ok) {
        return { ok: false, error: propertyResolutionError(resolved.error) };
    }

    return {
        ok: true,
        value: resolved.value,
        properties: cloneSnapshot(result.data),
    };
}
