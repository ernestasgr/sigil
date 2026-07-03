import type { Capability } from '@sigil/schema/manifest';

export interface PermissionOverrideStore {
    readonly get: (pluginId: string) => readonly Capability[];
    readonly has: (pluginId: string) => boolean;
    readonly set: (pluginId: string, overrides: readonly Capability[]) => void;
    readonly all: () => Readonly<Record<string, readonly Capability[]>>;
}

export function createPermissionOverrideStore(): PermissionOverrideStore {
    const overrides = new Map<string, readonly Capability[]>();

    return {
        get: (pluginId) => {
            const stored = overrides.get(pluginId);
            return stored ? [...stored] : [];
        },
        has: (pluginId) => {
            return overrides.has(pluginId);
        },
        set: (pluginId, caps) => {
            overrides.set(pluginId, [...caps]);
        },
        all: () => {
            const snapshot: Record<string, readonly Capability[]> = {};
            for (const [id, caps] of overrides) {
                snapshot[id] = [...caps];
            }
            return Object.freeze(snapshot);
        },
    };
}
