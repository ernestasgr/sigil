import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Effect, Option } from 'effect';

import type { Capability } from '@sigil/schema/manifest';

export interface PermissionOverrideStore {
    readonly get: (pluginId: string) => readonly Capability[];
    readonly has: (pluginId: string) => boolean;
    readonly set: (pluginId: string, overrides: readonly Capability[]) => void;
    readonly all: () => Readonly<Record<string, readonly Capability[]>>;
}

function loadOverrides(path: Option.Option<string>): Map<string, readonly Capability[]> {
    const map = new Map<string, readonly Capability[]>();
    if (Option.isNone(path) || !existsSync(path.value)) return map;

    Effect.try(() => {
        const raw = JSON.parse(readFileSync(path.value, 'utf-8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            for (const [id, caps] of Object.entries(raw)) {
                if (Array.isArray(caps)) {
                    map.set(id, caps as readonly Capability[]);
                }
            }
        }
    }).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.runSync,
    );

    return map;
}

function saveOverrides(
    path: Option.Option<string>,
    overrides: Map<string, readonly Capability[]>,
): void {
    if (Option.isNone(path)) return;
    const obj: Record<string, readonly string[]> = {};
    for (const [id, caps] of overrides) {
        obj[id] = caps;
    }
    Effect.try(() => {
        writeFileSync(path.value, JSON.stringify(obj, null, 2), 'utf-8');
    }).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.runSync,
    );
}

export function createPermissionOverrideStore(persistencePath?: string): PermissionOverrideStore {
    const pathOption = Option.fromNullable(persistencePath ?? null);
    const overrides = loadOverrides(pathOption);

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
            saveOverrides(pathOption, overrides);
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
