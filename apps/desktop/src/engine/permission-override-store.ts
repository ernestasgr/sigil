import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Capability } from '@sigil/schema/manifest';

export interface PermissionOverrideStore {
    readonly get: (pluginId: string) => readonly Capability[];
    readonly has: (pluginId: string) => boolean;
    readonly set: (pluginId: string, overrides: readonly Capability[]) => void;
    readonly all: () => Readonly<Record<string, readonly Capability[]>>;
}

function loadOverrides(path?: string): Map<string, readonly Capability[]> {
    const map = new Map<string, readonly Capability[]>();
    if (!path || !existsSync(path)) return map;
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            for (const [id, caps] of Object.entries(raw)) {
                if (Array.isArray(caps)) {
                    map.set(id, caps as readonly Capability[]);
                }
            }
        }
    } catch {
        // ignore corrupt file, start fresh
    }
    return map;
}

function saveOverrides(
    path: string | undefined,
    overrides: Map<string, readonly Capability[]>,
): void {
    if (!path) return;
    const obj: Record<string, readonly string[]> = {};
    for (const [id, caps] of overrides) {
        obj[id] = caps;
    }
    try {
        writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
        // best-effort persistence
    }
}

export function createPermissionOverrideStore(persistencePath?: string): PermissionOverrideStore {
    const overrides = loadOverrides(persistencePath);

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
            saveOverrides(persistencePath, overrides);
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
