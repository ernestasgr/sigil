import type { Manifest } from '@sigil/schema/manifest';

export type ManifestRegistryResult =
    | { readonly ok: true; readonly value: Manifest }
    | { readonly ok: false; readonly error: 'duplicate' };

export interface ManifestRegistry {
    readonly register: (manifest: Manifest) => ManifestRegistryResult;
    readonly unregister: (pluginId: string) => void;
    readonly get: (pluginId: string) => Manifest | undefined;
    readonly has: (pluginId: string) => boolean;
    readonly all: () => readonly Manifest[];
}

function cloneManifest(manifest: Manifest): Manifest {
    return structuredClone(manifest);
}

export function createManifestRegistry(): ManifestRegistry {
    const manifests = new Map<string, Manifest>();
    return {
        register: (manifest) => {
            if (manifests.has(manifest.id)) {
                return { ok: false, error: 'duplicate' };
            }
            const snapshot = cloneManifest(manifest);
            manifests.set(manifest.id, snapshot);
            return { ok: true, value: snapshot };
        },
        unregister: (pluginId) => {
            manifests.delete(pluginId);
        },
        get: (pluginId) => {
            const manifest = manifests.get(pluginId);
            return manifest ? cloneManifest(manifest) : undefined;
        },
        has: (pluginId) => manifests.has(pluginId),
        all: () => [...manifests.values()].map(cloneManifest),
    };
}
