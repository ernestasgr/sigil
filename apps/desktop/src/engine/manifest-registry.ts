import type { Manifest } from '@sigil/schema/manifest';

export type ManifestRegistryResult =
    | { readonly ok: true; readonly value: Manifest }
    | { readonly ok: false; readonly error: 'duplicate' };

export interface ManifestRegistry {
    readonly register: (manifest: Manifest) => ManifestRegistryResult;
    readonly get: (pluginId: string) => Manifest | undefined;
    readonly has: (pluginId: string) => boolean;
    readonly all: () => readonly Manifest[];
}

export function createManifestRegistry(): ManifestRegistry {
    const manifests = new Map<string, Manifest>();
    return {
        register: (manifest) => {
            if (manifests.has(manifest.id)) {
                return { ok: false, error: 'duplicate' };
            }
            manifests.set(manifest.id, manifest);
            return { ok: true, value: manifest };
        },
        get: (pluginId) => manifests.get(pluginId),
        has: (pluginId) => manifests.has(pluginId),
        all: () => [...manifests.values()],
    };
}
