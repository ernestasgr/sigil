import type { Capability } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';

import {
    formatPersistenceDiagnostic,
    type PermissionOverrideOutcome,
} from '../../shared/persistence.js';
import { effectiveCapabilityView } from '../persistence/capability-broker.js';
import type { PermissionOverrideStore } from '../persistence/permission-override-store.js';
import type { ManifestRegistry } from '../plugins/manifest-registry.js';

export interface PermissionOverrideTransitionDependencies {
    readonly registry: Pick<ManifestRegistry, 'get'>;
    readonly permissionOverrides: Pick<PermissionOverrideStore, 'get' | 'set'>;
    readonly revokeFileWatcherSubscriptions: (pluginId: string) => void;
    readonly updatePluginPermissions: (
        pluginId: string,
        permissions: readonly Capability[],
    ) => void;
}

export function applyPermissionOverride(
    dependencies: PermissionOverrideTransitionDependencies,
    pluginId: string,
    overrides: readonly Capability[],
): PermissionOverrideOutcome {
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

    const result = dependencies.permissionOverrides.set(pluginId, overrides);
    if (Either.isLeft(result)) {
        return {
            ok: false,
            kind: 'persistence',
            error: formatPersistenceDiagnostic(result.left),
            diagnostic: result.left,
        };
    }

    const effectivePermissions = effectiveCapabilityView(
        manifest.value.permissions,
        dependencies.permissionOverrides.get(pluginId),
    );
    if (!effectivePermissions.includes('filesystem.read')) {
        dependencies.revokeFileWatcherSubscriptions(pluginId);
    }
    dependencies.updatePluginPermissions(pluginId, effectivePermissions);

    return { ok: true, grantedPermissions: effectivePermissions };
}
