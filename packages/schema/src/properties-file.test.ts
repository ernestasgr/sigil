import { describe, expect, it } from 'vitest';

import { DEFAULT_PROPERTIES, loadPropertiesFile, PropertiesFileSchema } from './properties-file.js';

describe('PropertiesFileSchema', () => {
    it('accepts an object with notifyOnWorkflowError set to false', () => {
        const result = PropertiesFileSchema.safeParse({ notifyOnWorkflowError: false });
        expect(result.success).toBe(true);
    });

    it('accepts an object omitting notifyOnWorkflowError', () => {
        const result = PropertiesFileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('passes through unknown plugin-settings keys without error', () => {
        const result = PropertiesFileSchema.safeParse({
            notifyOnWorkflowError: true,
            'file-watcher': { ignorePatterns: ['*.tmp'] },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.notifyOnWorkflowError).toBe(true);
        }
    });

    it('rejects a non-boolean notifyOnWorkflowError', () => {
        const result = PropertiesFileSchema.safeParse({ notifyOnWorkflowError: 'yes' });
        expect(result.success).toBe(false);
    });

    it('accepts a string databasePath', () => {
        const result = PropertiesFileSchema.safeParse({ databasePath: '/data/sigil.db' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.databasePath).toBe('/data/sigil.db');
        }
    });

    it('accepts an object omitting databasePath', () => {
        const result = PropertiesFileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('rejects a non-string databasePath', () => {
        const result = PropertiesFileSchema.safeParse({ databasePath: 123 });
        expect(result.success).toBe(false);
    });

    it('rejects a non-object root', () => {
        const result = PropertiesFileSchema.safeParse('not an object');
        expect(result.success).toBe(false);
    });
});

describe('loadPropertiesFile', () => {
    it('returns ok with the explicit value when notifyOnWorkflowError is set', () => {
        const result = loadPropertiesFile({ notifyOnWorkflowError: false });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(false);
        }
    });

    it('falls back to the hardcoded default when the key is absent', () => {
        const result = loadPropertiesFile({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(true);
        }
    });

    it('falls back to the hardcoded default when the root is not an object', () => {
        const result = loadPropertiesFile('nope');
        expect(result.ok).toBe(false);
    });

    it('rejects a non-boolean notifyOnWorkflowError with an error message', () => {
        const result = loadPropertiesFile({ notifyOnWorkflowError: 1 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.length).toBeGreaterThan(0);
        }
    });

    it('DEFAULT_PROPERTIES enables notifyOnWorkflowError', () => {
        expect(DEFAULT_PROPERTIES.notifyOnWorkflowError).toBe(true);
    });

    it('resolves databasePath from the file content', () => {
        const result = loadPropertiesFile({ databasePath: '/data/sigil.db' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/data/sigil.db');
        }
    });

    it('falls back to the hardcoded :memory: default when databasePath is absent', () => {
        const result = loadPropertiesFile({});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe(':memory:');
        }
    });

    it('DEFAULT_PROPERTIES uses :memory: for databasePath', () => {
        expect(DEFAULT_PROPERTIES.databasePath).toBe(':memory:');
    });

    it('uses caller-provided defaults when the key is absent from the file', () => {
        const result = loadPropertiesFile({}, { databasePath: '/userData/sigil.db' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/userData/sigil.db');
        }
    });

    it('caller-provided defaults do not override an explicit value in the file', () => {
        const result = loadPropertiesFile(
            { databasePath: '/explicit/sigil.db' },
            { databasePath: '/userData/sigil.db' },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.databasePath).toBe('/explicit/sigil.db');
        }
    });

    it('caller-provided defaults can override notifyOnWorkflowError', () => {
        const result = loadPropertiesFile({}, { notifyOnWorkflowError: false });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.notifyOnWorkflowError).toBe(false);
        }
    });
});
