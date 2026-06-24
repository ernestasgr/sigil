import { NodeTypeSchema } from '@sigil/schema/nodes';
import { describe, expect, it } from 'vitest';

import { compileGraph } from './compile.js';
import { defaultSpecFor } from './node-defaults.js';

const ALL_TYPES = NodeTypeSchema.options;

describe('defaultSpecFor', () => {
    it('returns a spec whose type matches the request', () => {
        const spec = defaultSpecFor('log');
        expect(spec.type).toBe('log');
    });

    for (const type of ALL_TYPES) {
        it(`produces a schema-valid default config for "${type}"`, () => {
            const spec = defaultSpecFor(type);
            const node = { id: 'n', data: spec };
            const result = compileGraph([node], [], { id: 'p', workflowId: 'w' });
            expect(result.ok).toBe(true);
        });
    }

    it('gives the switch node a default case', () => {
        const spec = defaultSpecFor('switch');
        expect(spec.type).toBe('switch');
        if (spec.type === 'switch') {
            expect(spec.config.cases.length).toBeGreaterThan(0);
        }
    });
});
