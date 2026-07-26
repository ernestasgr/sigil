import { describe, expect, it } from 'vitest';

import { DelayConfigSchema, MAX_DELAY_MS } from './delay.js';

describe('DelayConfigSchema', () => {
    it.each([0, 1, 1_000, MAX_DELAY_MS])(
        'accepts the supported delay value %d without changing it',
        (ms) => {
            const result = DelayConfigSchema.safeParse({ ms });

            expect(result.success).toBe(true);
            if (result.success) expect(result.data.ms).toBe(ms);
        },
    );

    it.each([
        -1,
        0.5,
        MAX_DELAY_MS + 1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])('rejects unsupported delay value %s', (ms) => {
        expect(DelayConfigSchema.safeParse({ ms }).success).toBe(false);
    });
});
