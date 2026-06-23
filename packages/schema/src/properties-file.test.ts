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
});
