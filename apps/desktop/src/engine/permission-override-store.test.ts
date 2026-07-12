import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Either } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AtomicFileWriter } from './atomic-file.js';
import { createPermissionOverrideStore } from './permission-override-store.js';

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sigil-permission-overrides-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

describe('createPermissionOverrideStore', () => {
    it('returns empty overrides for an unknown plugin', () => {
        const store = createPermissionOverrideStore();
        expect(store.get('com.sigil.unknown')).toEqual([]);
    });

    it('stores and retrieves overrides for a plugin', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.test', ['filesystem.read', 'network']);
        expect(store.get('com.sigil.test')).toEqual(['filesystem.read', 'network']);
    });

    it('overwrites existing overrides on second set', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.test', ['filesystem.read']);
        store.set('com.sigil.test', ['network']);
        expect(store.get('com.sigil.test')).toEqual(['network']);
    });

    it('returns all overrides from all()', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.a', ['filesystem.read']);
        store.set('com.sigil.b', ['network']);
        const all = store.all();
        expect(all).toEqual({
            'com.sigil.a': ['filesystem.read'],
            'com.sigil.b': ['network'],
        });
    });

    it('returns a snapshot from all() that cannot mutate internal state', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.a', ['filesystem.read']);
        const all = store.all();
        (all as Record<string, string[]>)['com.sigil.a'].push('injected');
        expect(store.get('com.sigil.a')).toEqual(['filesystem.read']);
    });

    it('returns an empty object from all() when no overrides exist', () => {
        const store = createPermissionOverrideStore();
        expect(store.all()).toEqual({});
    });

    it('returns a frozen snapshot from all()', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.a', ['filesystem.read']);
        const all = store.all();
        expect(Object.isFrozen(all)).toBe(true);
    });

    it('reports has=true for a plugin with overrides set', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.test', ['filesystem.read']);
        expect(store.has('com.sigil.test')).toBe(true);
    });

    it('reports has=true for a plugin with empty overrides set', () => {
        const store = createPermissionOverrideStore();
        store.set('com.sigil.test', []);
        expect(store.has('com.sigil.test')).toBe(true);
    });

    it('reports has=false for a plugin with no overrides', () => {
        const store = createPermissionOverrideStore();
        expect(store.has('com.sigil.unknown')).toBe(false);
    });

    it('does not update memory or report success when the atomic replacement fails', () => {
        const path = join(tempDir, 'permission-overrides.json');
        const writer: AtomicFileWriter = {
            write: () =>
                Either.left({
                    kind: 'persistence',
                    operation: 'write',
                    phase: 'replace',
                    path,
                    message: 'replacement denied',
                }),
        };
        const store = createPermissionOverrideStore(path, writer);

        const result = store.set('com.sigil.test', ['network']);

        expect(Either.isLeft(result)).toBe(true);
        expect(store.has('com.sigil.test')).toBe(false);
        expect(store.get('com.sigil.test')).toEqual([]);
    });

    it('surfaces malformed persisted overrides as a structured diagnostic', () => {
        const path = join(tempDir, 'permission-overrides.json');
        writeFileSync(path, '{invalid}', 'utf8');

        const store = createPermissionOverrideStore(path);

        expect(store.get('com.sigil.test')).toEqual([]);
        expect(store.diagnostics()).toEqual([
            expect.objectContaining({
                kind: 'persistence',
                operation: 'read',
                phase: 'parse',
                path,
            }),
        ]);
    });

    it('surfaces persisted file read failures as open diagnostics', () => {
        const path = join(tempDir, 'permission-overrides.json');
        mkdirSync(path);

        const store = createPermissionOverrideStore(path);

        expect(store.diagnostics()).toEqual([
            expect.objectContaining({
                kind: 'persistence',
                operation: 'read',
                phase: 'open',
                path,
                code: 'EISDIR',
            }),
        ]);
    });

    it('commits overrides atomically before exposing them in memory', () => {
        const path = join(tempDir, 'permission-overrides.json');
        const store = createPermissionOverrideStore(path);

        expect(Either.isRight(store.set('com.sigil.test', ['network']))).toBe(true);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
            'com.sigil.test': ['network'],
        });
    });

    it('creates a missing parent directory before committing overrides', () => {
        const path = join(tempDir, 'nested', 'permission-overrides.json');
        const store = createPermissionOverrideStore(path);

        expect(Either.isRight(store.set('com.sigil.test', ['network']))).toBe(true);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
            'com.sigil.test': ['network'],
        });
    });
});
