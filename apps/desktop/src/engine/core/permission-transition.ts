import type { PluginId } from '@sigil/contracts/ids';
import type { Capability } from '@sigil/contracts/manifest';
import { Either, Option } from 'effect';

import {
    createPluginPermissionChangedEvent,
    type PermissionTransitionActor,
    type PluginPermissionChangedEvent,
} from '../../shared/event-payload-schemas.js';
import {
    formatPersistenceDiagnostic,
    type PermissionOverrideOutcome,
} from '../../shared/persistence.js';
import { effectiveCapabilityView } from '../persistence/capability-broker.js';
import type { PermissionOverrideStore } from '../persistence/permission-override-store.js';
import type { ManifestRegistry } from '../plugins/manifest-registry.js';

export type PermissionTransitionRunReconciler = (
    pluginId: PluginId,
    manifestPermissions: readonly Capability[],
    effectivePermissions: readonly Capability[],
) => Promise<readonly string[]>;

export interface PermissionOverrideTransitionDependencies {
    readonly registry: Pick<ManifestRegistry, 'get'>;
    readonly permissionOverrides: Pick<PermissionOverrideStore, 'get' | 'has' | 'set'>;
    readonly reconcileActiveWorkflowRuns?: PermissionTransitionRunReconciler;
    readonly revokeFileWatcherSubscriptions: (pluginId: PluginId) => void;
    readonly updatePluginPermissions: (
        pluginId: PluginId,
        permissions: readonly Capability[],
    ) => void;
    readonly emitPermissionChanged?: (event: PluginPermissionChangedEvent) => void;
}

const latestPermissionTransitionVersions = new WeakMap<object, Map<PluginId, number>>();

function beginPermissionTransition(
    permissionOverrides: PermissionOverrideTransitionDependencies['permissionOverrides'],
    pluginId: PluginId,
): number {
    let versions = latestPermissionTransitionVersions.get(permissionOverrides);
    if (!versions) {
        versions = new Map();
        latestPermissionTransitionVersions.set(permissionOverrides, versions);
    }

    const version = (versions.get(pluginId) ?? 0) + 1;
    versions.set(pluginId, version);
    return version;
}

function isLatestPermissionTransition(
    permissionOverrides: PermissionOverrideTransitionDependencies['permissionOverrides'],
    pluginId: PluginId,
    version: number,
): boolean {
    return latestPermissionTransitionVersions.get(permissionOverrides)?.get(pluginId) === version;
}

function capabilityViewsEqual(
    previous: readonly Capability[],
    next: readonly Capability[],
): boolean {
    return (
        previous.length === next.length &&
        previous.every((permission, index) => permission === next[index])
    );
}

export async function applyPermissionOverride(
    dependencies: PermissionOverrideTransitionDependencies,
    pluginId: PluginId,
    overrides: readonly Capability[],
    actor: PermissionTransitionActor = 'user',
): Promise<PermissionOverrideOutcome> {
    const manifest = dependencies.registry.get(pluginId);
    if (Option.isNone(manifest)) {
        return {
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId,
            error: `Plugin "${pluginId}" is not registered in the Manifest Registry.`,
        };
    }

    const previousEffectivePermissions = effectiveCapabilityView(
        manifest.value.permissions,
        dependencies.permissionOverrides.has(pluginId)
            ? dependencies.permissionOverrides.get(pluginId)
            : undefined,
    );
    const result = dependencies.permissionOverrides.set(pluginId, overrides);
    if (Either.isLeft(result)) {
        return {
            ok: false,
            kind: 'persistence',
            error: formatPersistenceDiagnostic(result.left),
            diagnostic: result.left,
        };
    }

    const transitionVersion = beginPermissionTransition(dependencies.permissionOverrides, pluginId);

    const effectivePermissions = effectiveCapabilityView(
        manifest.value.permissions,
        dependencies.permissionOverrides.get(pluginId),
    );
    if (!effectivePermissions.includes('filesystem.read')) {
        dependencies.revokeFileWatcherSubscriptions(pluginId);
    }

    const revokedPermissions = previousEffectivePermissions.filter(
        (permission) => !effectivePermissions.includes(permission),
    );
    let cancelledRunIds: readonly string[] = [];
    if (revokedPermissions.length > 0 && dependencies.reconcileActiveWorkflowRuns !== undefined) {
        try {
            cancelledRunIds = await dependencies.reconcileActiveWorkflowRuns(
                pluginId,
                manifest.value.permissions,
                effectivePermissions,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
                `[permission-transition] Active Workflow reconciliation failed for Plugin "${pluginId}": ${message}`,
            );
        }
    }
    if (
        isLatestPermissionTransition(dependencies.permissionOverrides, pluginId, transitionVersion)
    ) {
        dependencies.updatePluginPermissions(pluginId, effectivePermissions);
        if (!capabilityViewsEqual(previousEffectivePermissions, effectivePermissions)) {
            try {
                dependencies.emitPermissionChanged?.(
                    createPluginPermissionChangedEvent({
                        pluginId,
                        previous: previousEffectivePermissions,
                        next: effectivePermissions,
                        actor,
                        cancelledRuns: cancelledRunIds,
                    }),
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(
                    `[permission-transition] Permission change Event emission failed for Plugin "${pluginId}": ${message}`,
                );
            }
        }
    }

    return {
        ok: true,
        grantedPermissions: effectivePermissions,
        cancelledRunIds: [...cancelledRunIds],
    };
}
