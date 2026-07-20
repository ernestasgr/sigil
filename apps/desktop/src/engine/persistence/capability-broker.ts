import type { Capability, Manifest } from '@sigil/schema/manifest';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';
import { z } from 'zod';

import type { ManifestRegistry } from './manifest-registry.js';
import type { PermissionOverrideStore } from './permission-override-store.js';

export type { Capability, Manifest };

export const CapabilityRequestSchema = z
    .object({
        pluginId: z.string().min(1),
        capability: CapabilitySchema,
    })
    .readonly();
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

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
