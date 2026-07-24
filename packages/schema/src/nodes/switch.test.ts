import { describe, expect, it } from 'vitest';

import { outputPortDescriptorsForNode } from '../node-contract.js';
import { SwitchConfigSchema, validateSwitchConfig } from './switch.js';

describe('Switch descriptor', () => {
    it('keeps output-port identity separate from the editable match value', () => {
        const parsed = SwitchConfigSchema.safeParse({
            target: 'payload',
            field: 'ext',
            cases: [{ id: 'case-pdf', value: 'pdf' }],
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(outputPortDescriptorsForNode({ type: 'switch', config: parsed.data })).toEqual([
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
});
