import { describe, expect, it } from 'vitest';

import { SwitchConfigSchema, SwitchDescriptor, validateSwitchConfig } from './switch.js';

describe('Switch descriptor', () => {
    it('keeps output-port identity separate from the editable match value', () => {
        const parsed = SwitchConfigSchema.safeParse({
            target: 'payload',
            field: 'ext',
            cases: [{ id: 'case-pdf', value: 'pdf' }],
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(SwitchDescriptor.getOutputPorts(parsed.data)).toEqual(['default', 'case-pdf']);
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
