import { SwitchConfigSchema } from '@sigil/contracts/workflow';
import { describe, expect, it } from 'vitest';
import { outputPortDescriptorsForNode } from '../node-contract.js';
import { createBuiltinNodeContractRegistry } from './catalog.js';
import { canonicalizeSwitchValue, validateSwitchConfig } from './switch.js';

describe('Switch descriptor', () => {
    it('keeps output-port identity separate from the editable match value', () => {
        const parsed = SwitchConfigSchema.safeParse({
            target: 'payload',
            field: 'ext',
            comparison: 'string',
            cases: [{ id: 'case-pdf', value: 'pdf' }],
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(
                outputPortDescriptorsForNode(
                    { type: 'switch', config: parsed.data },
                    createBuiltinNodeContractRegistry(),
                ),
            ).toEqual([
                { id: 'default', label: 'default' },
                { id: 'case-pdf', label: 'pdf' },
            ]);
        }
    });

    it('keeps invalid draft values representable for structured topology diagnostics', () => {
        const parsed = SwitchConfigSchema.safeParse({
            target: 'event',
            cases: [
                { id: 'one', value: 'PDF' },
                { id: 'two', value: 'pdf' },
                { id: 'empty', value: '' },
                { id: 'reserved', value: 'default' },
            ],
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(validateSwitchConfig(parsed.data).map((diagnostic) => diagnostic.code)).toEqual(
                expect.arrayContaining([
                    'duplicate_match_value',
                    'empty_match_value',
                    'reserved_match_value',
                ]),
            );
        }
    });

    it('requires an explicit comparison for field-based matching', () => {
        expect(
            SwitchConfigSchema.safeParse({
                target: 'payload',
                field: 'size',
                cases: [{ id: 'case-one', value: '1' }],
            }).success,
        ).toBe(false);
        expect(
            SwitchConfigSchema.safeParse({
                target: 'payload',
                field: 'size',
                comparison: 'number',
                cases: [{ id: 'case-one', value: '1' }],
            }).success,
        ).toBe(true);
    });

    it('uses comparison-specific canonical values for duplicate diagnostics', () => {
        const stringConfig = SwitchConfigSchema.parse({
            target: 'payload',
            field: 'ext',
            comparison: 'string',
            cases: [
                { id: 'first', value: ' PDF ' },
                { id: 'second', value: 'pdf' },
            ],
        });
        expect(validateSwitchConfig(stringConfig).map((diagnostic) => diagnostic.code)).toEqual([
            'duplicate_match_value',
            'duplicate_match_value',
        ]);

        const numericConfig = SwitchConfigSchema.parse({
            target: 'payload',
            field: 'size',
            comparison: 'number',
            cases: [
                { id: 'first', value: '1' },
                { id: 'second', value: ' 1.0 ' },
                { id: 'third', value: 'not-a-number' },
            ],
        });
        expect(validateSwitchConfig(numericConfig).map((diagnostic) => diagnostic.code)).toEqual(
            expect.arrayContaining([
                'duplicate_match_value',
                'duplicate_match_value',
                'invalid_numeric_match_value',
            ]),
        );
    });

    it('shares canonicalization rules for authored and runtime values', () => {
        expect(canonicalizeSwitchValue('  PDF ', 'string')).toEqual({ ok: true, value: 'pdf' });
        expect(canonicalizeSwitchValue('01.0', 'number')).toEqual({ ok: true, value: '1' });
        expect(canonicalizeSwitchValue('not-a-number', 'number')).toEqual({
            ok: false,
            reason: 'invalid_number',
        });
    });
});
