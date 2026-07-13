import { DEFAULT_EVENT_CATALOG } from '@sigil/schema/event-catalog';
import { describe, expect, it } from 'vitest';

import { updateFieldCondition } from './condition-authoring.js';

describe('condition authoring catalog adapter', () => {
    it('uses a known field kind when changing a payload condition field', () => {
        expect(
            updateFieldCondition(
                {
                    target: 'payload',
                    field: 'ext',
                    operator: 'equals',
                    value: '',
                },
                'size',
                DEFAULT_EVENT_CATALOG,
            ),
        ).toEqual({
            target: 'payload',
            field: 'size',
            operator: 'equals',
            value: 0,
        });
    });

    it('preserves an opaque field condition instead of guessing its kind', () => {
        expect(
            updateFieldCondition(
                {
                    target: 'payload',
                    field: 'size',
                    operator: 'gt',
                    value: 5,
                },
                'pluginValue',
                DEFAULT_EVENT_CATALOG,
            ),
        ).toEqual({
            target: 'payload',
            field: 'pluginValue',
            operator: 'gt',
            value: 5,
        });
    });
});
