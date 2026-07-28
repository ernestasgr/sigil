import { EventNameSchema, PluginIdSchema } from '@sigil/contracts/ids';
import type { Manifest } from '@sigil/contracts/plugins';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { createManifestRegistry } from './manifest-registry.js';

const stubManifest: Manifest = {
    id: PluginIdSchema.parse('com.sigil.stub-ping'),
    version: '0.0.1',
    permissions: ['filesystem.read'],
    emits: [EventNameSchema.parse('stub.ping')],
};
const STUB_PLUGIN_ID = stubManifest.id;
const UNKNOWN_PLUGIN_ID = PluginIdSchema.parse('com.sigil.unknown');

describe('createManifestRegistry', () => {
    it('registers a manifest and retrieves it by plugin id', () => {
        const registry = createManifestRegistry();
        const result = registry.register(stubManifest);
        expect(Either.isRight(result)).toBe(true);

        const manifest = registry.get(STUB_PLUGIN_ID);
        expect(Option.isSome(manifest)).toBe(true);
        expect(Option.getOrThrow(manifest)).toEqual(stubManifest);
    });

    it('reports has=true for a registered plugin', () => {
        const registry = createManifestRegistry();
        registry.register(stubManifest);
        expect(registry.has(STUB_PLUGIN_ID)).toBe(true);
    });

    it('reports has=false for an unregistered plugin', () => {
        const registry = createManifestRegistry();
        expect(registry.has(UNKNOWN_PLUGIN_ID)).toBe(false);
    });

    it('returns None for an unregistered plugin id', () => {
        const registry = createManifestRegistry();
        expect(Option.isNone(registry.get(UNKNOWN_PLUGIN_ID))).toBe(true);
    });

    it('rejects duplicate registration of the same plugin id', () => {
        const registry = createManifestRegistry();
        const first = registry.register(stubManifest);
        expect(Either.isRight(first)).toBe(true);

        const second = registry.register(stubManifest);
        expect(Either.isLeft(second)).toBe(true);
        if (Either.isLeft(second)) {
            expect(second.left).toBe('duplicate');
        }
    });

    it('returns a frozen snapshot of all registered manifests', () => {
        const registry = createManifestRegistry();
        registry.register(stubManifest);
        const all = registry.all();
        expect(all).toHaveLength(1);
        expect(all[0]).toEqual(stubManifest);
    });
});
