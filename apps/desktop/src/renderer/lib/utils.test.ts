import { describe, expect, it } from 'vitest';

import { cn } from './utils.js';

describe('cn', () => {
    it('joins conditional class values', () => {
        const visible = false;
        expect(cn('a', visible && 'b', 'c')).toBe('a c');
    });

    it('resolves conflicting tailwind classes keeping the last', () => {
        expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    });
});
