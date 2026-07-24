import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capability, Manifest } from '@sigil/schema/manifest';
import { Either } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginPermissionChangedEvent } from '../../shared/event-payload-schemas.js';
import type { AtomicFileWriter } from '../persistence/atomic-file.js';
import { createCapabilityBroker } from '../persistence/capability-broker.js';
import { createPermissionOverrideStore } from '../persistence/permission-override-store.js';
import { createFileWatcherManager } from '../plugins/file-watcher-manager.js';
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

    it('does not emit a permission Event for an unknown Plugin', async () => {
        const emitPermissionChanged = vi.fn<(event: PluginPermissionChangedEvent) => void>();

        const result = await applyPermissionOverride(
            {
                registry: createManifestRegistry(),
                permissionOverrides: createPermissionOverrideStore(),
                revokeFileWatcherSubscriptions: vi.fn(),
                updatePluginPermissions: vi.fn(),
                emitPermissionChanged,
            },
            'com.sigil.unknown',
            [],
        );

        expect(result).toMatchObject({ ok: false, code: 'unknown_plugin' });
        expect(emitPermissionChanged).not.toHaveBeenCalled();
    });

    it('keeps the persisted selection, Broker view, worker view, and result aligned across repeated sets', async () => {
        const overridesPath = join(tempDir, 'permission-overrides.json');
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore(overridesPath);
        const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
        const workerPermissions = new Set<Capability>();
        const revokeFileWatcherSubscriptions = vi.fn();
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
            const result = await applyPermissionOverride(
                {
                    registry,
                    permissionOverrides,
                    revokeFileWatcherSubscriptions,
                    updatePluginPermissions,
                },
                pluginId,
                selection.requested,
            );

            expect(result).toEqual({
                ok: true,
                grantedPermissions: selection.effective,
                cancelledRunIds: [],
            });
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

    it('waits for dependent run supervisors before synchronizing the worker and returns their IDs', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const revokeFileWatcherSubscriptions = vi.fn();
        const updatePluginPermissions = vi.fn();
        let resolveReconciliation: (runIds: readonly string[]) => void = () => undefined;
        const reconciliation = new Promise<readonly string[]>((resolve) => {
            resolveReconciliation = resolve;
        });

        const transition = applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                reconcileActiveWorkflowRuns: async () => reconciliation,
                revokeFileWatcherSubscriptions,
                updatePluginPermissions,
            },
            pluginId,
            [],
        );

        expect(updatePluginPermissions).not.toHaveBeenCalled();
        resolveReconciliation(['run-active', 'run-queued']);

        await expect(transition).resolves.toEqual({
            ok: true,
            grantedPermissions: [],
            cancelledRunIds: ['run-active', 'run-queued'],
        });
        expect(updatePluginPermissions).toHaveBeenCalledWith(pluginId, []);
    });

    it('emits one permission Event after reconciliation and worker synchronization settle', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const order: string[] = [];
        const events: PluginPermissionChangedEvent[] = [];

        const result = await applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                reconcileActiveWorkflowRuns: async () => {
                    order.push('reconcile');
                    return ['run-revoked'];
                },
                revokeFileWatcherSubscriptions: () => {
                    order.push('revoke');
                },
                updatePluginPermissions: () => {
                    order.push('update');
                },
                emitPermissionChanged: (event) => {
                    order.push('emit');
                    events.push(event);
                },
            },
            pluginId,
            [],
            'startup_recovery',
        );

        expect(result).toEqual({
            ok: true,
            grantedPermissions: [],
            cancelledRunIds: ['run-revoked'],
        });
        expect(order).toEqual(['revoke', 'reconcile', 'update', 'emit']);
        expect(events).toEqual([
            {
                name: 'plugin.permission.changed',
                payload: {
                    pluginId,
                    previous: ['state.write', 'filesystem.read'],
                    next: [],
                    actor: 'startup_recovery',
                    cancelledRuns: ['run-revoked'],
                },
            },
        ]);
    });

    it('does not emit a permission Event when the Effective Capability View is unchanged', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        expect(Either.isRight(permissionOverrides.set(pluginId, ['state.write']))).toBe(true);
        const updatePluginPermissions = vi.fn();
        const emitPermissionChanged = vi.fn<(event: PluginPermissionChangedEvent) => void>();

        const result = await applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                revokeFileWatcherSubscriptions: vi.fn(),
                updatePluginPermissions,
                emitPermissionChanged,
            },
            pluginId,
            ['state.write'],
        );

        expect(result).toEqual({
            ok: true,
            grantedPermissions: ['state.write'],
            cancelledRunIds: [],
        });
        expect(updatePluginPermissions).toHaveBeenCalledWith(pluginId, ['state.write']);
        expect(emitPermissionChanged).not.toHaveBeenCalled();
    });

    it('contains permission Event emission failures after updating the worker', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const updatePluginPermissions = vi.fn();
        const emitPermissionChanged = vi.fn<(event: PluginPermissionChangedEvent) => void>(() => {
            throw new Error('bus unavailable');
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const result = await applyPermissionOverride(
                {
                    registry,
                    permissionOverrides,
                    revokeFileWatcherSubscriptions: vi.fn(),
                    updatePluginPermissions,
                    emitPermissionChanged,
                },
                pluginId,
                [],
            );

            expect(result).toEqual({
                ok: true,
                grantedPermissions: [],
                cancelledRunIds: [],
            });
            expect(updatePluginPermissions).toHaveBeenCalledWith(pluginId, []);
            expect(emitPermissionChanged).toHaveBeenCalledTimes(1);
            expect(consoleError).toHaveBeenCalledWith(
                `[permission-transition] Permission change Event emission failed for Plugin "${pluginId}": bus unavailable`,
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('does not let an older reconciliation re-grant permissions from a newer override', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const revokeFileWatcherSubscriptions = vi.fn();
        const updatePluginPermissions = vi.fn();
        const reconciliationResolvers: Array<(runIds: readonly string[]) => void> = [];
        const reconcileActiveWorkflowRuns = vi.fn(
            () =>
                new Promise<readonly string[]>((resolve) => {
                    reconciliationResolvers.push(resolve);
                }),
        );

        const olderTransition = applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                reconcileActiveWorkflowRuns,
                revokeFileWatcherSubscriptions,
                updatePluginPermissions,
            },
            pluginId,
            ['state.write'],
        );
        const newerTransition = applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                reconcileActiveWorkflowRuns,
                revokeFileWatcherSubscriptions,
                updatePluginPermissions,
            },
            pluginId,
            [],
        );

        expect(reconcileActiveWorkflowRuns).toHaveBeenCalledTimes(2);
        reconciliationResolvers[1]?.([]);
        await expect(newerTransition).resolves.toEqual({
            ok: true,
            grantedPermissions: [],
            cancelledRunIds: [],
        });
        expect(updatePluginPermissions).toHaveBeenLastCalledWith(pluginId, []);

        reconciliationResolvers[0]?.([]);
        await expect(olderTransition).resolves.toEqual({
            ok: true,
            grantedPermissions: ['state.write'],
            cancelledRunIds: [],
        });
        expect(permissionOverrides.get(pluginId)).toEqual([]);
        expect(updatePluginPermissions).toHaveBeenCalledTimes(1);
        expect(updatePluginPermissions).toHaveBeenLastCalledWith(pluginId, []);
    });

    it('synchronizes the worker when active run reconciliation fails', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const revokeFileWatcherSubscriptions = vi.fn();
        const updatePluginPermissions = vi.fn();
        const reconciliationError = new Error('supervisor shutdown failed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const result = await applyPermissionOverride(
                {
                    registry,
                    permissionOverrides,
                    reconcileActiveWorkflowRuns: vi.fn().mockRejectedValue(reconciliationError),
                    revokeFileWatcherSubscriptions,
                    updatePluginPermissions,
                },
                pluginId,
                [],
            );

            expect(result).toEqual({
                ok: true,
                grantedPermissions: [],
                cancelledRunIds: [],
            });
            expect(permissionOverrides.get(pluginId)).toEqual([]);
            expect(updatePluginPermissions).toHaveBeenCalledWith(pluginId, []);
            expect(consoleError).toHaveBeenCalledWith(
                `[permission-transition] Active Workflow reconciliation failed for Plugin "${pluginId}": supervisor shutdown failed`,
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it('preserves every prior view when the atomic write fails', async () => {
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
        const revokeFileWatcherSubscriptions = vi.fn();
        const updatePluginPermissions = vi.fn();
        const emitPermissionChanged = vi.fn<(event: PluginPermissionChangedEvent) => void>();

        const result = await applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                revokeFileWatcherSubscriptions,
                updatePluginPermissions,
                emitPermissionChanged,
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
        expect(emitPermissionChanged).not.toHaveBeenCalled();
    });

    it('revokes owned File Watcher subscriptions before notifying a worker about read removal', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const fileWatcherManager = createFileWatcherManager(
            undefined,
            () => ({ close: () => {} }),
            () => ({ size: 1 }),
        );
        const order: string[] = [];

        fileWatcherManager.registerSubscriber(
            {
                id: 'revoked-subscription',
                path: '/shared',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
            pluginId,
        );
        fileWatcherManager.registerSubscriber(
            {
                id: 'surviving-subscription',
                path: '/shared',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
            'com.sigil.other-plugin',
        );

        const result = await applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                revokeFileWatcherSubscriptions: (ownerPluginId) => {
                    order.push('revoke');
                    fileWatcherManager.unregisterSubscribersByOwner(ownerPluginId);
                },
                updatePluginPermissions: (_pluginId, permissions) => {
                    order.push('update');
                    expect(permissions).toEqual(['state.write']);
                    expect(fileWatcherManager.getSubscriberCount()).toBe(1);
                },
            },
            pluginId,
            ['state.write'],
        );

        expect(result).toEqual({
            ok: true,
            grantedPermissions: ['state.write'],
            cancelledRunIds: [],
        });
        expect(order).toEqual(['revoke', 'update']);
        expect(fileWatcherManager.getSubscriberIdsByOwner(pluginId)).toEqual([]);
        expect(fileWatcherManager.getSubscriberIdsByOwner('com.sigil.other-plugin')).toEqual([
            'surviving-subscription',
        ]);
        fileWatcherManager.dispose();
    });

    it('preserves owned File Watcher subscriptions while filesystem.read remains effective', async () => {
        const registry = createManifestRegistry();
        expect(Either.isRight(registry.register(manifest))).toBe(true);
        const permissionOverrides = createPermissionOverrideStore();
        const fileWatcherManager = createFileWatcherManager(
            undefined,
            () => ({ close: () => {} }),
            () => ({ size: 1 }),
        );
        const revokeFileWatcherSubscriptions = vi.fn();
        fileWatcherManager.registerSubscriber(
            {
                id: 'preserved-subscription',
                path: '/preserved',
                recursive: false,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
            pluginId,
        );

        const result = await applyPermissionOverride(
            {
                registry,
                permissionOverrides,
                revokeFileWatcherSubscriptions,
                updatePluginPermissions: vi.fn(),
            },
            pluginId,
            ['filesystem.read'],
        );

        expect(result).toEqual({
            ok: true,
            grantedPermissions: ['filesystem.read'],
            cancelledRunIds: [],
        });
        expect(revokeFileWatcherSubscriptions).not.toHaveBeenCalled();
        expect(fileWatcherManager.getSubscriberIdsByOwner(pluginId)).toEqual([
            'preserved-subscription',
        ]);
        fileWatcherManager.dispose();
    });
});
