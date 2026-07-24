import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capability, Manifest } from '@sigil/schema/manifest';
import { Either } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicFileWriter } from '../persistence/atomic-file.js';
import { createCapabilityBroker } from '../persistence/capability-broker.js';
import { createPermissionOverrideStore } from '../persistence/permission-override-store.js';
import { createManifestRegistry } from '../plugins/manifest-registry.js';
import { applyPermissionOverride } from './permission-transition.js';

const pluginId = 'com.sigil.permission-transition';
const manifest: Manifest = {
    id: pluginId,
    version: '1.0.0',
    permissions: ['state.write', 'filesystem.read'],
    emits: ['stub.event'],
};

describe('applyPermissionOverride', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-permission-transition-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('keeps the persisted selection, Broker view, worker view, and result aligned across repeated sets', () => {
        const overridesPath = join(tempDir, 'permission-overrides.json');
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore(overridesPath);
        const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
        const workerPermissions = new Set<Capability>();
        const updatePluginPermissions = vi.fn(
            (_pluginId: string, permissions: readonly Capability[]): void => {
                workerPermissions.clear();
                for (const permission of permissions) workerPermissions.add(permission);
            },
        );

        const selections: readonly {
            readonly requested: readonly Capability[];
            readonly effective: readonly Capability[];
        }[] = [
            {
                requested: ['filesystem.read', 'network'],
                effective: ['filesystem.read'],
            },
            {
                requested: ['state.write'],
                effective: ['state.write'],
            },
            { requested: [], effective: [] },
        ];

        for (const selection of selections) {
            const result = applyPermissionOverride(
                {
                    registry,
                    permissionOverrides,
                    updatePluginPermissions,
                },
                pluginId,
                selection.requested,
            );

            expect(result).toEqual({ ok: true, grantedPermissions: selection.effective });
            expect(permissionOverrides.get(pluginId)).toEqual(selection.requested);
            expect(JSON.parse(readFileSync(overridesPath, 'utf8'))).toEqual({
                [pluginId]: selection.requested,
            });
            expect([...workerPermissions]).toEqual(selection.effective);
            expect(updatePluginPermissions).toHaveBeenLastCalledWith(pluginId, selection.effective);

            for (const capability of manifest.permissions) {
                const brokerResult = capabilityBroker.request({ pluginId, capability });
                expect(Either.isRight(brokerResult)).toBe(selection.effective.includes(capability));
            }
        }
    });

    it('preserves every prior view when the atomic write fails', () => {
        const overridesPath = join(tempDir, 'permission-overrides.json');
        const initialOverrides = createPermissionOverrideStore(overridesPath);
        expect(Either.isRight(initialOverrides.set(pluginId, ['filesystem.read']))).toBe(true);

        const failedWriter: AtomicFileWriter = {
            write: (targetPath) =>
                Either.left({
                    kind: 'persistence',
                    operation: 'write',
                    phase: 'replace',
                    path: targetPath,
                    message: 'replacement interrupted',
                }),
        };
        const permissionOverrides = createPermissionOverrideStore(overridesPath, failedWriter);
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
        const workerPermissions = new Set<Capability>(['filesystem.read']);
        const updatePluginPermissions = vi.fn();

        const result = applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                updatePluginPermissions,
            },
            pluginId,
            ['state.write'],
        );

        expect(result).toMatchObject({
            ok: false,
            kind: 'persistence',
            diagnostic: { phase: 'replace', path: overridesPath },
        });
        expect(permissionOverrides.get(pluginId)).toEqual(['filesystem.read']);
        expect(JSON.parse(readFileSync(overridesPath, 'utf8'))).toEqual({
            [pluginId]: ['filesystem.read'],
        });
        expect([...workerPermissions]).toEqual(['filesystem.read']);
        expect(
            Either.isRight(
                capabilityBroker.request({
                    pluginId,
                    capability: 'filesystem.read',
                }),
            ),
        ).toBe(true);
        expect(
            Either.isLeft(
                capabilityBroker.request({
                    pluginId,
                    capability: 'state.write',
                }),
            ),
        ).toBe(true);
        expect(updatePluginPermissions).not.toHaveBeenCalled();
    });
});
