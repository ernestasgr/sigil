import { existsSync, readFileSync } from 'node:fs';
import { type PluginId, PluginIdSchema } from '@sigil/contracts/ids';
import { type Capability, CapabilitySchema } from '@sigil/contracts/manifest';
import { Either, Option } from 'effect';
import { z } from 'zod';
import {
    type PersistenceDiagnostic,
    type PersistencePhase,
    persistenceErrorCode,
} from '../../shared/persistence.js';
import {
    type AtomicFileWriter,
    type AtomicWriteResult,
    atomicFileWriter,
    createAtomicWriteFailure,
} from './atomic-file.js';

export interface PermissionOverrideStore {
    readonly get: (pluginId: PluginId) => readonly Capability[];
    readonly has: (pluginId: PluginId) => boolean;
    readonly set: (pluginId: PluginId, overrides: readonly Capability[]) => AtomicWriteResult;
    readonly all: () => Readonly<Record<string, readonly Capability[]>>;
    readonly diagnostics: () => readonly PersistenceDiagnostic[];
}

function diagnostic(
    path: string,
    phase: PersistencePhase,
    message: string,
    error?: unknown,
): PersistenceDiagnostic {
    const code = error === undefined ? undefined : persistenceErrorCode(error);
    return {
        kind: 'persistence',
        operation: 'read',
        phase,
        path,
        message,
        ...(code ? { code } : {}),
    };
}

function loadOverrides(
    path: Option.Option<string>,
    diagnostics: PersistenceDiagnostic[],
): Map<PluginId, readonly Capability[]> {
    const map = new Map<PluginId, readonly Capability[]>();
    if (Option.isNone(path) || !existsSync(path.value)) return map;

    let content: string;
    try {
        content = readFileSync(path.value, 'utf-8');
    } catch (error) {
        diagnostics.push(
            diagnostic(
                path.value,
                'open',
                error instanceof Error ? error.message : String(error),
                error,
            ),
        );
        return map;
    }

    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch (error) {
        diagnostics.push(
            diagnostic(path.value, 'parse', error instanceof Error ? error.message : String(error)),
        );
        return map;
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        diagnostics.push(
            diagnostic(path.value, 'parse', 'Permission overrides must be a JSON object.'),
        );
        return map;
    }

    for (const [id, caps] of Object.entries(raw)) {
        const parsedId = PluginIdSchema.safeParse(id);
        if (!parsedId.success) {
            diagnostics.push(
                diagnostic(
                    path.value,
                    'parse',
                    `Permission overrides for plugin "${id}" are malformed: ${parsedId.error.issues[0]?.message ?? 'expected a canonical Plugin ID.'}`,
                ),
            );
            continue;
        }

        const parsed = z.array(CapabilitySchema).safeParse(caps);
        if (parsed.success) {
            map.set(parsedId.data, parsed.data);
        } else {
            diagnostics.push(
                diagnostic(
                    path.value,
                    'parse',
                    `Permission overrides for plugin "${id}" are malformed: ${parsed.error.issues[0]?.message ?? 'expected an array of capabilities.'}`,
                ),
            );
        }
    }

    return map;
}

function saveOverrides(
    path: Option.Option<string>,
    overrides: ReadonlyMap<PluginId, readonly Capability[]>,
    writer: AtomicFileWriter,
): AtomicWriteResult {
    if (Option.isNone(path)) return Either.right(undefined);
    const obj: Record<string, readonly string[]> = {};
    for (const [id, caps] of overrides) {
        obj[id] = caps;
    }

    let contents: string;
    try {
        contents = JSON.stringify(obj, null, 2);
    } catch (error) {
        return Either.left(createAtomicWriteFailure(path.value, 'serialize', error));
    }
    return writer.write(path.value, contents, { createDirectory: true });
}

export function createPermissionOverrideStore(
    persistencePath?: string,
    writer: AtomicFileWriter = atomicFileWriter,
): PermissionOverrideStore {
    const pathOption = Option.fromNullable(persistencePath ?? null);
    const diagnostics: PersistenceDiagnostic[] = [];
    let overrides = loadOverrides(pathOption, diagnostics);

    return {
        get: (pluginId) => {
            const stored = overrides.get(pluginId);
            return stored ? [...stored] : [];
        },
        has: (pluginId) => {
            return overrides.has(pluginId);
        },
        set: (pluginId, caps) => {
            const next = new Map(overrides);
            next.set(pluginId, [...caps]);
            const result = saveOverrides(pathOption, next, writer);
            if (Either.isRight(result)) {
                overrides = next;
            }
            return result;
        },
        all: () => {
            const snapshot: Record<string, readonly Capability[]> = {};
            for (const [id, caps] of overrides) {
                snapshot[id] = [...caps];
            }
            return Object.freeze(snapshot);
        },
        diagnostics: () => [...diagnostics],
    };
}
