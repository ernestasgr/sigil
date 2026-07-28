import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CapabilitySchema, ManifestSchema, parseManifest } from './manifest.js';
import {
    normalizeNodeConfigurationSchema,
    SerializableJsonSchemaSchema,
    SerializableNodeConfigurationSchema,
    serializeNodeConfigurationSchema,
} from './node-contract.js';

const ANY_CONFIG_SCHEMA = {
    version: 1,
    dialect: 'https://json-schema.org/draft/2020-12/schema',
    schema: {},
} as const;

function cyclicPluginManifest(defaultConfig: unknown): Record<string, unknown> {
    return {
        id: 'com.sigil.cyclic-contract',
        version: '0.0.1',
        permissions: [],
        emits: ['contract.output'],
        nodeType: 'cyclic-node',
        nodeContract: {
            identity: {
                namespace: 'plugin',
                pluginId: 'com.sigil.cyclic-contract',
                type: 'cyclic-node',
            },
            version: 1,
            role: 'action',
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig,
            outputPorts: {
                kind: 'fixed',
                ports: [{ id: 'out', label: 'Output' }],
            },
            display: {
                label: 'Cyclic Node',
                description: 'Rejects cyclic contract data.',
                category: 'utility',
            },
        },
    };
}

describe('CapabilitySchema', () => {
    it('accepts a known capability', () => {
        const result = CapabilitySchema.safeParse('filesystem.read');
        expect(result.success).toBe(true);
    });

    it('rejects an unknown capability', () => {
        const result = CapabilitySchema.safeParse('filesystem.delete');
        expect(result.success).toBe(false);
    });
});

describe('ManifestSchema', () => {
    it('accepts a well-formed manifest', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: ['filesystem.read'],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(true);
    });

    it('accepts a manifest with no permissions', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects a manifest missing id', () => {
        const result = ManifestSchema.safeParse({
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects a manifest missing version', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            permissions: [],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects a manifest with an empty emits array', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: [],
        });
        expect(result.success).toBe(false);
    });

    it('rejects duplicate Event declarations with a Manifest issue at the duplicate entry', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping', 'stub.ping'],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toContainEqual(
                expect.objectContaining({
                    path: ['emits', 1],
                    message: expect.stringContaining('declared more than once'),
                }),
            );
        }
    });

    it('returns structured issues for invalid Event declarations', () => {
        const result = parseManifest({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['Stub.Ping'],
        });

        expect(result).toMatchObject({
            ok: false,
            issues: [
                expect.objectContaining({
                    path: ['emits', 0],
                }),
            ],
        });
    });

    it('rejects a manifest with an unknown capability in permissions', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: ['filesystem.delete'],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(false);
    });

    it('accepts a manifest with a nodeType', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.my-plugin',
            version: '0.0.1',
            permissions: [],
            emits: ['my.event'],
            nodeType: 'my-plugin-node',
        });
        expect(result.success).toBe(true);
    });

    it('accepts a serializable Plugin Node Contract tied to the manifest identity', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.my-plugin',
            version: '0.0.1',
            permissions: [],
            emits: ['my.event'],
            nodeType: 'my-plugin-node',
            nodeContract: {
                identity: {
                    namespace: 'plugin',
                    pluginId: 'com.sigil.my-plugin',
                    type: 'my-plugin-node',
                },
                version: 1,
                role: 'action',
                configSchema: ANY_CONFIG_SCHEMA,
                defaultConfig: { enabled: true },
                outputPorts: {
                    kind: 'fixed',
                    ports: [{ id: 'out', label: 'Output' }],
                },
                display: {
                    label: 'My Plugin Node',
                    description: 'A test Plugin Node.',
                    category: 'utility',
                },
            },
        });

        expect(result.success).toBe(true);
    });

    it('rejects a Plugin Contract that is not serializable or does not match its manifest', () => {
        expect(
            ManifestSchema.safeParse({
                id: 'com.sigil.my-plugin',
                version: '0.0.1',
                permissions: [],
                emits: ['my.event'],
                nodeType: 'my-plugin-node',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.sigil.other',
                        type: 'my-plugin-node',
                    },
                    version: 1,
                    role: 'action',
                    configSchema: ANY_CONFIG_SCHEMA,
                    defaultConfig: { callback: () => undefined },
                    outputPorts: {
                        kind: 'fixed',
                        ports: [{ id: 'out', label: 'Output' }],
                    },
                    display: {
                        label: 'My Plugin Node',
                        description: 'A test Plugin Node.',
                        category: 'utility',
                    },
                },
            }).success,
        ).toBe(false);
    });

    it('rejects a Plugin Contract that declares an unsupported configuration schema dialect', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.dialect-plugin',
            version: '0.0.1',
            permissions: [],
            emits: ['dialect.event'],
            nodeType: 'dialect-node',
            nodeContract: {
                identity: {
                    namespace: 'plugin',
                    pluginId: 'com.sigil.dialect-plugin',
                    type: 'dialect-node',
                },
                version: 1,
                role: 'action',
                configSchema: {
                    version: 1,
                    dialect: 'https://json-schema.org/draft-07/schema#',
                    schema: {},
                },
                defaultConfig: {},
                outputPorts: {
                    kind: 'fixed',
                    ports: [{ id: 'out', label: 'Output' }],
                },
                display: {
                    label: 'Dialect Node',
                    description: 'Rejects unsupported configuration schema dialects.',
                    category: 'utility',
                },
            },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: ['nodeContract', 'configSchema', 'dialect'] }),
                ]),
            );
        }
    });

    it('accepts a manifest without a nodeType (non-node plugin)', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects unknown manifest fields instead of silently dropping them', () => {
        const result = ManifestSchema.safeParse({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
            unexpected: true,
        });
        expect(result.success).toBe(false);
    });
});

describe('parseManifest', () => {
    it('returns ok for a valid manifest', () => {
        const result = parseManifest({
            id: 'com.sigil.stub-ping',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        });
        expect(result.ok).toBe(true);
    });

    it('returns an error for a missing manifest (null)', () => {
        const result = parseManifest(null);
        expect(result.ok).toBe(false);
    });

    it('returns an error for a missing manifest (undefined)', () => {
        const result = parseManifest(undefined);
        expect(result.ok).toBe(false);
    });

    it('returns an error for an inconsistent manifest', () => {
        const result = parseManifest({ id: 'x' });
        expect(result.ok).toBe(false);
    });

    it('returns a structured error for a cyclic Plugin contract', () => {
        const cyclicConfig: Record<string, unknown> = {};
        cyclicConfig.loop = cyclicConfig;
        const manifest = cyclicPluginManifest(cyclicConfig);

        expect(() => parseManifest(manifest)).not.toThrow();

        expect(parseManifest(manifest)).toMatchObject({
            ok: false,
            error: expect.stringContaining('cyclic'),
        });
    });
});

describe('Plugin Node configuration schema envelope', () => {
    it('normalizes the explicit dialect marker without changing boolean schemas', () => {
        const normalized = normalizeNodeConfigurationSchema({
            version: 1,
            dialect: 'https://json-schema.org/draft/2020-12/schema',
            schema: { type: 'object' },
        });
        expect(normalized.schema).toMatchObject({
            type: 'object',
            $schema: 'https://json-schema.org/draft/2020-12/schema',
        });

        expect(
            normalizeNodeConfigurationSchema({
                version: 1,
                dialect: 'https://json-schema.org/draft/2020-12/schema',
                schema: false,
            }).schema,
        ).toBe(false);
    });

    it('requires the envelope dialect and JSON Schema dialect to agree', () => {
        const result = SerializableNodeConfigurationSchema.safeParse({
            version: 1,
            dialect: 'https://json-schema.org/draft/2020-12/schema',
            schema: {
                $schema: 'https://json-schema.org/draft-07/schema#',
            },
        });

        expect(result.success).toBe(false);
        expect(SerializableJsonSchemaSchema.safeParse(false).success).toBe(true);
        expect(SerializableJsonSchemaSchema.safeParse([]).success).toBe(false);
        expect(SerializableJsonSchemaSchema.safeParse({ callback: () => undefined }).success).toBe(
            false,
        );
    });

    it('serializes a runtime Zod schema into the supported wire format', () => {
        const result = serializeNodeConfigurationSchema(z.object({ name: z.string() }));

        expect(result).toMatchObject({
            version: 1,
            dialect: 'https://json-schema.org/draft/2020-12/schema',
            schema: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
            },
        });
    });

    it('returns a typed error when a runtime schema cannot be serialized', () => {
        expect(() =>
            serializeNodeConfigurationSchema(z.string().transform((value) => value)),
        ).toThrow(/configuration schema could not be serialized/i);
    });
});
