import { describe, expect, it } from 'vitest';

import { createPermissionOverrideStore } from './permission-override-store.js';

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
});
