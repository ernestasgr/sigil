import type { ResolvedProperties } from '@sigil/contracts/properties-file';
import {
    DEFAULT_IGNORE_PATTERNS,
    DEFAULT_PROPERTIES,
    definePropertyDescriptor,
    PROPERTY_DESCRIPTORS,
    PropertiesFileSchema,
    SerializedPropertyDescriptorSchema,
    serializePropertyDescriptor,
} from '@sigil/contracts/properties-file';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PropertyResolutionResult } from './property-registry.js';
import { createPropertyRegistry, loadPropertiesFile } from './property-registry.js';

function resolvedValue<T>(result: PropertyResolutionResult<T>): T {
    if (!result.ok) throw new Error(`Expected a resolved property, got ${result.kind}.`);
    return result.value;
}

function loadBuiltinProperties(
    value: unknown,
    defaults: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof loadPropertiesFile> {
    return loadPropertiesFile(value, createPropertyRegistry(), defaults);
}

describe('Property registry', () => {
    it('serializes a descriptor and restores it from JSON Schema', () => {
        const descriptor = definePropertyDescriptor(
            'example-plugin.enabled',
            z.object({ enabled: z.boolean() }),
            { enabled: false },
            'hot',
        );
        const serialized = serializePropertyDescriptor(descriptor);
        const registry = createPropertyRegistry([]);

        expect(descriptor.apply).toBe('hot');
        expect(serialized.apply).toBe('hot');
        const registration = registry.register(serialized);

        expect(registration).toMatchObject({
            ok: true,
            registered: true,
            descriptor: { key: 'example-plugin.enabled', fallback: { enabled: false } },
        });
        expect(
            registry.schema().safeParse({ 'example-plugin.enabled': { enabled: true } }).success,
        ).toBe(true);
        expect(registry.defaults()['example-plugin.enabled']).toEqual({ enabled: false });
    });

    it('reports invalid descriptor inputs without changing the registry', () => {
        const registry = createPropertyRegistry([]);

        expect(
            registry.register({
                key: 'missing.apply',
                schema: z.string(),
                fallback: 'value',
            } as never),
        ).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_descriptor',
                key: 'missing.apply',
                message: expect.stringContaining('apply mode'),
            },
        });

        expect(
            registry.register({ key: '', schema: z.string(), fallback: 'value', apply: 'hot' }),
        ).toMatchObject({
            ok: false,
            error: { kind: 'invalid_descriptor' },
        });
        expect(
            registry.register({
                key: 'invalid.schema',
                schema: 42 as never,
                fallback: 'value',
                apply: 'hot',
            }),
        ).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_descriptor',
                key: 'invalid.schema',
            },
        });
        expect(
            registry.register({
                key: 'invalid.json-schema',
                schema: { type: 'not-a-json-schema' },
                fallback: 'value',
                apply: 'hot',
            }),
        ).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_descriptor',
                key: 'invalid.json-schema',
            },
        });
        expect(
            registry.register({
                key: 'invalid.fallback',
                schema: z.string(),
                fallback: 42 as never,
                apply: 'hot',
            }),
        ).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_descriptor',
                key: 'invalid.fallback',
            },
        });
        expect(registry.has('invalid.fallback')).toBe(false);
        expect(() =>
            serializePropertyDescriptor({
                key: 'invalid.fallback',
                schema: z.string(),
                fallback: 42 as never,
                apply: 'hot',
            }),
        ).toThrow(/does not match its schema/);
    });

    it('rejects reserved keys and non-JSON-safe fallbacks', () => {
        const registry = createPropertyRegistry([]);

        expect(
            registry.register({
                key: '__proto__',
                schema: z.string(),
                fallback: 'value',
                apply: 'hot',
            }),
        ).toMatchObject({
            ok: false,
            error: { kind: 'invalid_descriptor', key: '__proto__' },
        });
        expect(registry.has('__proto__')).toBe(false);

        expect(
            SerializedPropertyDescriptorSchema.safeParse({
                key: 'serialized.invalid-fallback',
                schema: { type: 'string' },
                fallback: undefined,
                apply: 'hot',
            }).success,
        ).toBe(false);
        expect(
            registry.register({
                key: 'invalid.json-fallback',
                schema: z.bigint(),
                fallback: 1n,
                apply: 'hot',
            }),
        ).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid_descriptor',
                key: 'invalid.json-fallback',
                message: 'Property descriptor fallback must be JSON-safe.',
            },
        });
        expect(() =>
            serializePropertyDescriptor({
                key: 'invalid.json-fallback',
                schema: z.bigint(),
                fallback: 1n,
                apply: 'hot',
            }),
        ).toThrow('must be JSON-safe');
    });

    it('only accepts an exact descriptor when allowing an existing key', () => {
        const registry = createPropertyRegistry([]);
        const descriptor = definePropertyDescriptor(
            'example-plugin.mode',
            z.string(),
            'safe',
            'hot',
        );

        expect(registry.register(descriptor)).toMatchObject({ ok: true, registered: true });
        expect(registry.register(descriptor)).toMatchObject({
            ok: false,
            error: { kind: 'duplicate', key: 'example-plugin.mode' },
        });
        expect(registry.register(descriptor, { allowExisting: true })).toMatchObject({
            ok: true,
            registered: false,
        });
        expect(
            registry.register(
                definePropertyDescriptor('example-plugin.mode', z.string(), 'unsafe', 'hot'),
                { allowExisting: true },
            ),
        ).toMatchObject({
            ok: false,
            error: { kind: 'duplicate', key: 'example-plugin.mode' },
        });
        expect(
            registry.register(
                definePropertyDescriptor('example-plugin.mode', z.number(), 1, 'hot'),
                {
                    allowExisting: true,
                },
            ),
        ).toMatchObject({
            ok: false,
            error: { kind: 'duplicate', key: 'example-plugin.mode' },
        });
    });

    it('rolls back a batch when a later descriptor is invalid or duplicated', () => {
        const first = definePropertyDescriptor('example-plugin.first', z.string(), 'first', 'hot');
        const second = definePropertyDescriptor('example-plugin.second', z.number(), 2, 'hot');
        const registry = createPropertyRegistry([]);

        expect(
            registry.registerMany([
                first,
                {
                    key: 'example-plugin.invalid',
                    schema: z.string(),
                    fallback: 42 as never,
                    apply: 'hot',
                },
            ]),
        ).toMatchObject({
            ok: false,
            error: { kind: 'invalid_descriptor', key: 'example-plugin.invalid' },
        });
        expect(registry.has(first.key)).toBe(false);

        expect(registry.registerMany([first, first])).toMatchObject({
            ok: false,
            error: { kind: 'duplicate', key: first.key },
        });
        expect(registry.has(first.key)).toBe(false);

        expect(registry.registerMany([first, second], { owner: 'example-plugin' })).toMatchObject({
            ok: true,
            registeredKeys: [first.key, second.key],
        });
        expect(registry.get(first.key)).toEqual(expect.objectContaining({ key: first.key }));
        expect(registry.has(second.key)).toBe(true);
        expect(registry.all().map((descriptor) => descriptor.key)).toEqual([first.key, second.key]);

        registry.unregisterOwner('different-owner');
        expect(registry.has(first.key)).toBe(true);
        registry.unregisterOwner('example-plugin');
        expect(registry.has(first.key)).toBe(false);
        expect(registry.has(second.key)).toBe(false);
        registry.unregister('missing-key');
    });

    it('resolves a registered key through explicit, file, caller fallback, and descriptor fallback values', () => {
        const registry = createPropertyRegistry([
            definePropertyDescriptor('example-plugin.mode', z.string(), 'hardcoded', 'hot'),
        ]);

        expect(
            resolvedValue(
                registry.resolve('example-plugin.mode', {
                    explicit: 'explicit',
                    properties: { 'example-plugin.mode': 'from-file' },
                    fallback: 'caller-fallback',
                }),
            ),
        ).toBe('explicit');
        expect(
            resolvedValue(
                registry.resolve('example-plugin.mode', {
                    properties: { 'example-plugin.mode': 'from-file' },
                    fallback: 'caller-fallback',
                }),
            ),
        ).toBe('from-file');
        expect(
            resolvedValue(
                registry.resolve('example-plugin.mode', {
                    properties: {},
                    fallback: 'caller-fallback',
                }),
            ),
        ).toBe('caller-fallback');
        expect(resolvedValue(registry.resolve('example-plugin.mode', { properties: {} }))).toBe(
            'hardcoded',
        );
        expect(registry.resolve('missing-key', { properties: {} })).toMatchObject({
            ok: false,
            kind: 'missing',
        });
    });

    it('validates the winning source instead of trusting or skipping an invalid value', () => {
        const registry = createPropertyRegistry([
            definePropertyDescriptor('example-plugin.count', z.number().int(), 1, 'hot'),
        ]);

        expect(
            registry.resolve('example-plugin.count', {
                explicit: 'not-a-number',
                properties: { 'example-plugin.count': 2 },
                fallback: 3,
            }),
        ).toMatchObject({ ok: false, kind: 'invalid', source: 'explicit' });
        expect(
            registry.resolve('example-plugin.count', {
                properties: { 'example-plugin.count': 'not-a-number' },
                fallback: 3,
            }),
        ).toMatchObject({ ok: false, kind: 'invalid', source: 'properties-file' });
        expect(
            registry.resolve('example-plugin.count', {
                properties: {},
                fallback: 'not-a-number',
            }),
        ).toMatchObject({ ok: false, kind: 'invalid', source: 'caller-fallback' });
    });

    it('keeps registry ownership isolated and built-in snapshots immutable', () => {
        const first = createPropertyRegistry();
        const second = createPropertyRegistry();
        const descriptor = definePropertyDescriptor(
            'example-plugin.isolated',
            z.boolean(),
            false,
            'hot',
        );

        expect(first.register(descriptor, { owner: 'example-plugin' }).ok).toBe(true);
        expect(first.has(descriptor.key)).toBe(true);
        expect(second.has(descriptor.key)).toBe(false);

        expect(first.unregisterOwner('example-plugin')).toEqual([descriptor.key]);
        expect(first.has(descriptor.key)).toBe(false);
        expect(second.has(descriptor.key)).toBe(false);
        expect(first.unregister('notifyOnWorkflowError')).toBe(false);
        expect(first.has('notifyOnWorkflowError')).toBe(true);

        const defaults = first.defaults();
        expect(Object.isFrozen(defaults)).toBe(true);
        expect(Object.isFrozen(defaults['file-watcher.ignorePatterns'])).toBe(true);
        expect(Object.isFrozen(first.get('notifyOnWorkflowError'))).toBe(true);
    });

    it('returns a typed invalid result when a batch fallback does not match its descriptor', () => {
        const registry = createPropertyRegistry();

        const result = registry.resolveAll({}, { notifyOnWorkflowError: 'yes' });

        expect(result).toMatchObject({
            ok: false,
            error: {
                kind: 'invalid',
                key: 'notifyOnWorkflowError',
                source: 'caller-fallback',
            },
        });
    });

    it('refreshes its schema and defaults when a descriptor is removed', () => {
        const registry = createPropertyRegistry([]);
        const descriptor = definePropertyDescriptor(
            'example-plugin.enabled',
            z.boolean(),
            false,
            'hot',
        );

        registry.register(descriptor);
        expect(registry.schema().safeParse({ 'example-plugin.enabled': true }).success).toBe(true);
        expect(registry.defaults()['example-plugin.enabled']).toBe(false);

        registry.unregister(descriptor.key);

        expect(registry.schema().safeParse({ 'example-plugin.enabled': true }).success).toBe(false);
        expect(registry.defaults()).toEqual({});
    });

    it('rejects invalid or duplicate initial descriptors', () => {
        const descriptor = definePropertyDescriptor(
            'example-plugin.mode',
            z.string(),
            'safe',
            'hot',
        );

        expect(() => createPropertyRegistry([descriptor, descriptor])).toThrow(
            `Duplicate property "${descriptor.key}"`,
        );
        expect(() =>
            createPropertyRegistry([
                {
                    key: 'example-plugin.invalid',
                    schema: z.string(),
                    fallback: 42 as never,
                    apply: 'hot',
                },
            ]),
        ).toThrow(/does not match its schema/);
    });

    it('registers a descriptor into one Engine-owned registry', () => {
        const descriptor = definePropertyDescriptor(
            'example-plugin.global-enabled',
            z.boolean(),
            false,
            'hot',
        );

        const registry = createPropertyRegistry();
        expect(registry.register(descriptor)).toMatchObject({
            ok: true,
            registered: true,
        });
        expect(registry.schema().safeParse({ 'example-plugin.global-enabled': true }).success).toBe(
            true,
        );
    });
});

describe('Properties resolution', () => {
    it('registers a Plugin descriptor into validation and default resolution', () => {
        const registry = createPropertyRegistry();
        const registration = registry.register(
            definePropertyDescriptor('example-plugin.enabled', z.boolean(), false, 'hot'),
        );

        expect(registration.ok).toBe(true);
        expect(registry.schema().safeParse({ 'example-plugin.enabled': true }).success).toBe(true);
        expect(registry.schema().safeParse({ 'example-plugin.enabled': 'yes' }).success).toBe(
            false,
        );
        const resolved = registry.resolveAll({});
        expect(resolved.ok).toBe(true);
        if (resolved.ok) expect(resolved.value['example-plugin.enabled']).toBe(false);

        const loaded = loadPropertiesFile({}, registry, { 'example-plugin.enabled': true });
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.value['example-plugin.enabled']).toBe(true);
        }
    });

    it('prefers an explicit value over the Properties File value', () => {
        const registry = createPropertyRegistry();
        expect(
            resolvedValue(
                registry.resolve('notifyOnWorkflowError', {
                    explicit: false,
                    properties: { notifyOnWorkflowError: true },
                }),
            ),
        ).toBe(false);
    });

    it('resolves all registered descriptors to their hardcoded fallbacks', () => {
        const registry = createPropertyRegistry();
        expect(Object.keys(PROPERTY_DESCRIPTORS)).toEqual([
            'notifyOnWorkflowError',
            'databasePath',
            'collisionSuffixStyle',
            'file-watcher.ignorePatterns',
            'file-manager.defaultOnConflict',
            'file-manager.collisionSuffixStyle',
        ]);
        const resolved = registry.resolveAll({});
        expect(resolved).toMatchObject({ ok: true });
        if (resolved.ok)
            expect(resolved.value).toEqual({
                notifyOnWorkflowError: true,
                databasePath: ':memory:',
                collisionSuffixStyle: 'windows',
                'file-watcher.ignorePatterns': DEFAULT_IGNORE_PATTERNS,
                'file-manager.defaultOnConflict': 'error',
                'file-manager.collisionSuffixStyle': 'windows',
            });
    });

    it('returns a typed resolved object containing engine and builtin plugin values', () => {
        const registry = createPropertyRegistry();
        const resolved = registry.resolveAll({
            notifyOnWorkflowError: false,
            databasePath: '/properties/sigil.db',
            collisionSuffixStyle: 'underscore',
            'file-watcher.ignorePatterns': ['*.user-defined'],
            'file-manager.defaultOnConflict': 'skip',
            'file-manager.collisionSuffixStyle': 'hyphen',
        });
        expect(resolved).toMatchObject({ ok: true });
        if (resolved.ok)
            expect(resolved.value).toEqual({
                notifyOnWorkflowError: false,
                databasePath: '/properties/sigil.db',
                collisionSuffixStyle: 'underscore',
                'file-watcher.ignorePatterns': ['*.user-defined'],
                'file-manager.defaultOnConflict': 'skip',
                'file-manager.collisionSuffixStyle': 'hyphen',
            });
    });

    it('enforces explicit, Properties File, then hardcoded precedence for every key', () => {
        const registry = createPropertyRegistry();
        const properties: Partial<ResolvedProperties> = {
            notifyOnWorkflowError: false,
            databasePath: '/properties/sigil.db',
            collisionSuffixStyle: 'underscore',
            'file-watcher.ignorePatterns': ['*.properties'],
            'file-manager.defaultOnConflict': 'skip',
            'file-manager.collisionSuffixStyle': 'hyphen',
        };
        const explicit: Partial<ResolvedProperties> = {
            notifyOnWorkflowError: true,
            databasePath: '/explicit/sigil.db',
            collisionSuffixStyle: 'hyphen',
            'file-watcher.ignorePatterns': ['*.explicit'],
            'file-manager.defaultOnConflict': 'overwrite',
            'file-manager.collisionSuffixStyle': 'underscore',
        };

        for (const key of Object.keys(PROPERTY_DESCRIPTORS) as (keyof ResolvedProperties)[]) {
            const propertyValue = properties[key];
            const explicitValue = explicit[key];
            if (propertyValue === undefined || explicitValue === undefined) {
                throw new Error(`Missing test value for ${key}`);
            }

            expect(resolvedValue(registry.resolve(key, { properties }))).toEqual(propertyValue);
            expect(
                resolvedValue(registry.resolve(key, { explicit: explicitValue, properties })),
            ).toEqual(explicitValue);
            expect(resolvedValue(registry.resolve(key, { properties: {} }))).toEqual(
                PROPERTY_DESCRIPTORS[key].fallback,
            );
        }
    });
});

describe('PropertiesFileSchema', () => {
    it('accepts an object with notifyOnWorkflowError set to false', () => {
        const result = PropertiesFileSchema.safeParse({ notifyOnWorkflowError: false });
        expect(result.success).toBe(true);
    });

    it('accepts an object omitting notifyOnWorkflowError', () => {
        const result = PropertiesFileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts every documented builtin plugin default', () => {
        const result = PropertiesFileSchema.safeParse({
            notifyOnWorkflowError: true,
            'file-watcher.ignorePatterns': ['*.tmp'],
            'file-manager.defaultOnConflict': 'skip',
            'file-manager.collisionSuffixStyle': 'hyphen',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.notifyOnWorkflowError).toBe(true);
        }
    });

    it('rejects an unknown key with a structured validation issue', () => {
        const result = PropertiesFileSchema.safeParse({ notifyOnWorklowError: true });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unrecognized_keys',
                        keys: ['notifyOnWorklowError'],
                    }),
                ]),
            );
        }
    });

    it('rejects a non-boolean notifyOnWorkflowError', () => {
        const result = PropertiesFileSchema.safeParse({ notifyOnWorkflowError: 'yes' });
        expect(result.success).toBe(false);
    });

    it('accepts a string databasePath', () => {
        const result = PropertiesFileSchema.safeParse({ databasePath: '/data/sigil.db' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.databasePath).toBe('/data/sigil.db');
        }
    });

    it('accepts an object omitting databasePath', () => {
        const result = PropertiesFileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('rejects a non-string databasePath', () => {
        const result = PropertiesFileSchema.safeParse({ databasePath: 123 });
        expect(result.success).toBe(false);
    });

    it('rejects a non-object root', () => {
        const result = PropertiesFileSchema.safeParse('not an object');
        expect(result.success).toBe(false);
    });
});

describe('loadPropertiesFile', () => {
    it('returns ok with the explicit value when notifyOnWorkflowError is set', () => {
        const result = loadBuiltinProperties({ notifyOnWorkflowError: false });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(false);
        }
    });

    it('falls back to the hardcoded default when the key is absent', () => {
        const result = loadBuiltinProperties({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(true);
        }
    });

    it('falls back to the hardcoded default when the root is not an object', () => {
        const result = loadBuiltinProperties('nope');
        expect(result.ok).toBe(false);
    });

    it('rejects a non-boolean notifyOnWorkflowError with an error message', () => {
        const result = loadBuiltinProperties({ notifyOnWorkflowError: 1 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.length).toBeGreaterThan(0);
        }
    });

    it('DEFAULT_PROPERTIES enables notifyOnWorkflowError', () => {
        expect(DEFAULT_PROPERTIES.notifyOnWorkflowError).toBe(true);
    });

    it('resolves databasePath from the file content', () => {
        const result = loadBuiltinProperties({ databasePath: '/data/sigil.db' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/data/sigil.db');
        }
    });

    it('falls back to the hardcoded :memory: default when databasePath is absent', () => {
        const result = loadBuiltinProperties({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe(':memory:');
        }
    });

    it('DEFAULT_PROPERTIES uses :memory: for databasePath', () => {
        expect(DEFAULT_PROPERTIES.databasePath).toBe(':memory:');
    });

    it('uses caller-provided defaults when the key is absent from the file', () => {
        const result = loadBuiltinProperties({}, { databasePath: '/userData/sigil.db' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/userData/sigil.db');
        }
    });

    it('caller-provided defaults do not override an explicit value in the file', () => {
        const result = loadBuiltinProperties(
            { databasePath: '/explicit/sigil.db' },
            { databasePath: '/userData/sigil.db' },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/explicit/sigil.db');
        }
    });

    it('caller-provided defaults can override notifyOnWorkflowError', () => {
        const result = loadBuiltinProperties({}, { notifyOnWorkflowError: false });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(false);
        }
    });

    it('resolves collisionSuffixStyle from the file content', () => {
        const result = loadBuiltinProperties({ collisionSuffixStyle: 'underscore' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.collisionSuffixStyle).toBe('underscore');
        }
    });

    it('defaults collisionSuffixStyle to windows when absent', () => {
        const result = loadBuiltinProperties({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.collisionSuffixStyle).toBe('windows');
        }
    });

    it('DEFAULT_PROPERTIES uses windows for collisionSuffixStyle', () => {
        expect(DEFAULT_PROPERTIES.collisionSuffixStyle).toBe('windows');
    });

    it('rejects an unknown collisionSuffixStyle', () => {
        const result = PropertiesFileSchema.safeParse({ collisionSuffixStyle: 'unknown' });
        expect(result.success).toBe(false);
    });
});
