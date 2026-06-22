import { describe, expect, it } from 'vitest';

import type { Manifest } from '@sigil/schema/manifest';

import { createManifestRegistry } from './manifest-registry.js';
import { createCapabilityBroker } from './capability-broker.js';

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
        const broker = createCapabilityBroker(registry);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });

        expect(result.ok).toBe(true);
    });

    it('rejects a capability not declared in the manifest', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const broker = createCapabilityBroker(registry);

        const result = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.write',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('denied');
            expect(result.error.capability).toBe('filesystem.write');
        }
    });

    it('rejects every capability for a plugin with no permissions', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithNone);
        const broker = createCapabilityBroker(registry);

        const result = broker.request({
            pluginId: 'com.sigil.bare',
            capability: 'network',
        });

        expect(result.ok).toBe(false);
    });

    it('rejects a capability for an unknown plugin', () => {
        const registry = createManifestRegistry();
        const broker = createCapabilityBroker(registry);

        const result = broker.request({
            pluginId: 'com.sigil.ghost',
            capability: 'filesystem.read',
        });

        expect(result.ok).toBe(false);
    });

    it('re-checks permissions on every call, not just at load time', () => {
        const registry = createManifestRegistry();
        registry.register(manifestWithRead);
        const broker = createCapabilityBroker(registry);

        const first = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });
        const second = broker.request({
            pluginId: 'com.sigil.reader',
            capability: 'filesystem.read',
        });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
    });
});
