import type { Capability, Manifest } from '@sigil/schema/manifest';

import type { ManifestRegistry } from './manifest-registry.js';

export type { Capability, Manifest };

export type CapabilityRequest = {
    readonly pluginId: string;
    readonly capability: Capability;
};

export type CapabilityResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly error: { readonly kind: 'denied'; readonly capability: Capability };
      };

export interface CapabilityBroker {
    readonly request: (request: CapabilityRequest) => CapabilityResult;
}

function hasPermission(manifest: Manifest | undefined, capability: Capability): boolean {
    return manifest !== undefined && manifest.permissions.includes(capability);
}

export function createCapabilityBroker(registry: ManifestRegistry): CapabilityBroker {
    return {
        request: ({ pluginId, capability }) => {
            if (!hasPermission(registry.get(pluginId), capability)) {
                return { ok: false, error: { kind: 'denied', capability } };
            }
            return { ok: true };
        },
    };
}
