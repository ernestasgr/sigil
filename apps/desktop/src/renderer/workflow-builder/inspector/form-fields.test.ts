import { describe, expect, it } from 'vitest';

import {
    getNumberInputBlurDraft,
    getNumberInputChange,
    getNumberInputId,
    getNumberInputValidation,
} from './number-input.js';

describe('NumberInput', () => {
    it.each(['-', '1e', ''])(
        'keeps partial or invalid draft value %j without emitting it',
        (rawValue) => {
            expect(getNumberInputChange(rawValue)).toEqual({
                draftValue: rawValue,
                value: null,
            });
        },
    );

    it('emits finite values while retaining their draft text', () => {
        expect(getNumberInputChange('12.5')).toEqual({
            draftValue: '12.5',
            value: 12.5,
        });
    });

    it('shows the error hint only for an invalid focused draft', () => {
        expect(getNumberInputValidation('', false, 'number-input')).toEqual({
            invalid: false,
            describedBy: undefined,
            errorMessage: undefined,
        });
        expect(getNumberInputValidation('', true, 'number-input')).toEqual({
            invalid: true,
            describedBy: 'number-input-hint',
            errorMessage: 'Enter a finite number.',
        });
        expect(getNumberInputValidation('12', true, 'number-input')).toEqual({
            invalid: false,
            describedBy: undefined,
            errorMessage: undefined,
        });
    });

    it('reverts an invalid draft on blur while preserving a valid draft', () => {
        expect(getNumberInputBlurDraft('-', 12, true)).toBe('12');
        expect(getNumberInputBlurDraft('12', 12, false)).toBe('12');
    });

    it('uses the provided id or falls back to the generated id', () => {
        expect(getNumberInputId('node-delay', ':r0:')).toBe('node-delay');
        expect(getNumberInputId(undefined, ':r0:')).toBe(':r0:');
    });
});
