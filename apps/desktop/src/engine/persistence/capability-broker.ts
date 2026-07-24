import type { Capability, Manifest } from '@sigil/schema/manifest';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';
import { z } from 'zod';

import type { ManifestRegistry } from '../plugins/manifest-registry.js';
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

/**
 * Return the capabilities that are both declared by a Manifest and selected by
 * a stored override. An absent override means the Manifest is authoritative;
 * an empty override is an explicit revoke-all selection.
 */
export function effectiveCapabilityView(
    manifestPermissions: readonly Capability[],
    storedOverride?: readonly Capability[],
): readonly Capability[] {
    if (storedOverride === undefined) return [...manifestPermissions];

    const selected = new Set(storedOverride);
    return manifestPermissions.filter((capability) => selected.has(capability));
}

function effectivePermissions(
    manifest: Option.Option<Manifest>,
    overrides: PermissionOverrideStore,
): readonly Capability[] {
    if (Option.isNone(manifest)) return [];

    const storedOverride = overrides.has(manifest.value.id)
        ? overrides.get(manifest.value.id)
        : undefined;
    return effectiveCapabilityView(manifest.value.permissions, storedOverride);
}

export function createCapabilityBroker(
    registry: ManifestRegistry,
    overrides: PermissionOverrideStore,
): CapabilityBroker {
    return {
        request: ({ pluginId, capability }) => {
            const allowed = effectivePermissions(registry.get(pluginId), overrides).includes(
                capability,
            );

            return allowed
                ? Either.right(undefined)
                : Either.left({ kind: 'denied' as const, capability });
        },
    };
}
