import type { Manifest } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { createManifestRegistry } from './manifest-registry.js';

const stubManifest: Manifest = {
    id: 'com.sigil.stub-ping',
    version: '0.0.1',
    permissions: ['filesystem.read'],
    emits: ['stub.ping'],
};

describe('createManifestRegistry', () => {
    it('registers a manifest and retrieves it by plugin id', () => {
        const registry = createManifestRegistry();
        const result = registry.register(stubManifest);
        expect(Either.isRight(result)).toBe(true);

        const manifest = registry.get('com.sigil.stub-ping');
        expect(Option.isSome(manifest)).toBe(true);
        expect(Option.getOrThrow(manifest)).toEqual(stubManifest);
    });

    it('reports has=true for a registered plugin', () => {
        const registry = createManifestRegistry();
        registry.register(stubManifest);
        expect(registry.has('com.sigil.stub-ping')).toBe(true);
    });

    it('reports has=false for an unregistered plugin', () => {
        const registry = createManifestRegistry();
        expect(registry.has('com.sigil.unknown')).toBe(false);
    });

    it('returns None for an unregistered plugin id', () => {
        const registry = createManifestRegistry();
        expect(Option.isNone(registry.get('com.sigil.unknown'))).toBe(true);
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
