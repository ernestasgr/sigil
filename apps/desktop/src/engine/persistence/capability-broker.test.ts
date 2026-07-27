import { EventNameSchema, PluginIdSchema } from '@sigil/contracts/ids';
import type { Manifest } from '@sigil/contracts/manifest';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createManifestRegistry } from '../plugins/manifest-registry.js';
import { createCapabilityBroker } from './capability-broker.js';
import { createPermissionOverrideStore } from './permission-override-store.js';

const READER_ID = PluginIdSchema.parse('com.sigil.reader');
const BARE_ID = PluginIdSchema.parse('com.sigil.bare');
const GHOST_ID = PluginIdSchema.parse('com.sigil.ghost');

const manifestWithRead: Manifest = {
    id: READER_ID,
    version: '0.0.1',
    permissions: ['filesystem.read'],
    emits: [EventNameSchema.parse('file.created')],
};

const manifestWithNone: Manifest = {
    id: BARE_ID,
    version: '0.0.1',
    permissions: [],
    emits: [EventNameSchema.parse('stub.ping')],
};

describe('createCapabilityBroker', () => {
    it('permits a capability declared in the manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: READER_ID,
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
            pluginId: READER_ID,
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
        overrides.set(BARE_ID, ['network']);
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: BARE_ID,
            capability: 'network',
        });

        expect(Either.isLeft(result)).toBe(true);
    });

    it('rejects a capability for an unknown plugin', () => {
        const registry = createManifestRegistry();
        const overrides = createPermissionOverrideStore();
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: GHOST_ID,
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
            pluginId: READER_ID,
            capability: 'filesystem.read',
        });
        const second = broker.request({
            pluginId: READER_ID,
            capability: 'filesystem.read',
        });

        expect(Either.isRight(first)).toBe(true);
        expect(Either.isRight(second)).toBe(true);
    });

    it('rejects a capability granted via override when it is not in the manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        overrides.set(READER_ID, ['filesystem.read', 'network']);
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: READER_ID,
            capability: 'network',
        });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.kind).toBe('denied');
            expect(result.left.capability).toBe('network');
        }
        expect(overrides.get(READER_ID)).toEqual(['filesystem.read', 'network']);
    });

    it('rejects a capability revoked via override even if in manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const overrides = createPermissionOverrideStore();
        overrides.set(READER_ID, []);
        const broker = createCapabilityBroker(registry, overrides);

        const result = broker.request({
            pluginId: READER_ID,
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

        overrides.set(READER_ID, []);
        const initiallyRevoked = broker.request({
            pluginId: READER_ID,
            capability: 'filesystem.read',
        });
        expect(Either.isLeft(initiallyRevoked)).toBe(true);

        overrides.set(READER_ID, ['filesystem.read']);
        const granted = broker.request({
            pluginId: READER_ID,
            capability: 'filesystem.read',
        });
        expect(Either.isRight(granted)).toBe(true);

        overrides.set(READER_ID, []);
        const revoked = broker.request({
            pluginId: READER_ID,
            capability: 'filesystem.read',
        });
        expect(Either.isLeft(revoked)).toBe(true);
    });
});
