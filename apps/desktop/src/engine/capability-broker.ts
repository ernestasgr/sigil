import type { Capability, Manifest } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';

import type { ManifestRegistry } from './manifest-registry.js';
import type { PermissionOverrideStore } from './permission-override-store.js';

export type { Capability, Manifest };

export type CapabilityRequest = {
    readonly pluginId: string;
    readonly capability: Capability;
};

export type CapabilityResult = Either.Either<
    void,
    { readonly kind: 'denied'; readonly capability: Capability }
>;

export interface CapabilityBroker {
    readonly request: (request: CapabilityRequest) => CapabilityResult;
}

function hasPermission(manifest: Option.Option<Manifest>, capability: Capability): boolean {
    return Option.isSome(manifest) && manifest.value.permissions.includes(capability);
}

export function createCapabilityBroker(
    registry: ManifestRegistry,
    overrides: PermissionOverrideStore,
): CapabilityBroker {
    return {
        request: ({ pluginId, capability }) => {
            const allowed = overrides.has(pluginId)
                ? overrides.get(pluginId).includes(capability)
                : hasPermission(registry.get(pluginId), capability);

            return allowed
                ? Either.right(undefined)
                : Either.left({ kind: 'denied' as const, capability });
        },
    };
}
