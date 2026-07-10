import { describe, expect, it } from 'vitest';
import { Either } from 'effect';

import type { Manifest } from '@sigil/schema/manifest';

import { createManifestRegistry } from './manifest-registry.js';
import { createCapabilityBroker } from './capability-broker.js';
import { createPermissionOverrideStore } from './permission-override-store.js';

const manifestWithRead: Manifest = {
    id: 'com.sigil.reader',
    version: '0.0.1',
    permissions: ['filesystem.read'],
    emits: ['file.created'],
};

const manifestWithNone: Manifest = {
    id: 'com.sigil.bare',
    version: '0.0.1',
    permissions: [],
    emits: ['stub.ping'],
};

describe('createCapabilityBroker', () => {
    it('permits a capability declared in the manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });

        expect(Either.isRight(result)).toBe(true);
    });

    it('rejects a capability not declared in the manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.write',
        });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.kind).toBe('denied');
            expect(result.left.capability).toBe('filesystem.write');
        }
    });

    it('rejects every capability for a plugin with no permissions', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithNone);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.bare',
            capability: 'network',
        });

        expect(Either.isLeft(result)).toBe(true);
    });

    it('rejects a capability for an unknown plugin', () => {
        const registry = createManifestRegistry();
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.ghost',
            capability: 'filesystem.read',
        });

        expect(Either.isLeft(result)).toBe(true);
    });

    it('re-checks permissions on every call, not just at load time', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const first = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });
        const second = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });

        expect(Either.isRight(first)).toBe(true);
        expect(Either.isRight(second)).toBe(true);
    });

    it('permits a capability granted via override even if not in manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        overrides.set('com.sigil.reader', ['filesystem.read', 'network']);
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'network',
        });

        expect(Either.isRight(result)).toBe(true);
    });

    it('rejects a capability revoked via override even if in manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        overrides.set('com.sigil.reader', []);
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.kind).toBe('denied');
            expect(result.left.capability).toBe('filesystem.read');
        }
    });

    it('honors override changes dynamically without recreating broker', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        overrides.set('com.sigil.reader', ['filesystem.read', 'filesystem.write']);
        const granted = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.write',
        });
        expect(Either.isRight(granted)).toBe(true);

        overrides.set('com.sigil.reader', ['filesystem.read']);
        const revoked = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.write',
        });
        expect(Either.isLeft(revoked)).toBe(true);
    });
});
