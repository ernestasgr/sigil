import { describe, expect, it } from 'vitest';

import { StateSetConfigSchema, StateSetDescriptor } from './state-set.js';

describe('StateSetConfigSchema', () => {
    it('keeps legacy configurations valid and gives new nodes a Text default', () => {
        const result = StateSetConfigSchema.safeParse({
            key: 'last-file',
            valueTemplate: '{{payload.name}}',
        });

        expect(result.success).toBe(true);
        expect(result.success && result.data.valueType).toBeUndefined();
        expect(StateSetDescriptor.defaultConfig.valueType).toBe('string');
    });

    it('accepts an optional value type for typed state values', () => {
        const result = StateSetConfigSchema.safeParse({
            key: 'retry-count',
            valueTemplate: '3',
            valueType: 'number',
        });

        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error.message);
        expect(result.data).toEqual({
            key: 'retry-count',
            valueTemplate: '3',
            valueType: 'number',
        });
    });

    it('rejects value types outside the supported primitive choices', () => {
        const result = StateSetConfigSchema.safeParse({
            key: 'retry-count',
            valueTemplate: '3',
            valueType: 'date',
        });

        expect(result.success).toBe(false);
    });
});
