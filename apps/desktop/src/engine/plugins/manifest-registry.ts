import type { Manifest } from '@sigil/schema/manifest';
import { Either, Option } from 'effect';

export type ManifestRegistryResult = Either.Either<Manifest, 'duplicate'>;

export interface ManifestRegistry {
    readonly register: (manifest: Manifest) => ManifestRegistryResult;
    readonly unregister: (pluginId: string) => void;
    readonly get: (pluginId: string) => Option.Option<Manifest>;
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
                return Either.left('duplicate');
            }
            const snapshot = cloneManifest(manifest);
            manifests.set(manifest.id, snapshot);
            return Either.right(snapshot);
        },
        unregister: (pluginId) => {
            manifests.delete(pluginId);
        },
        get: (pluginId) => {
            const manifest = manifests.get(pluginId);
            return manifest ? Option.some(cloneManifest(manifest)) : Option.none();
        },
        has: (pluginId) => manifests.has(pluginId),
        all: () => [...manifests.values()].map(cloneManifest),
    };
}
