import { CompiledPipelineSchema } from '@sigil/schema';
import { NodeTypeSchema } from '@sigil/schema/nodes';
import { describe, expect, it } from 'vitest';

import { type NodeSpec, nodeTypeDef } from './node-registry.js';

const ALL_TYPES = NodeTypeSchema.options;

describe('nodeTypeDef', () => {
    it('returns an entry whose type matches the request', () => {
        expect(nodeTypeDef('log').type).toBe('log');
    });

    it('carries a Form component for every registered type', () => {
        for (const type of ALL_TYPES) {
            expect(typeof nodeTypeDef(type).Form).toBe('function');
        }
    });

    for (const type of ALL_TYPES) {
        it(`produces a schema-valid default config for "${type}"`, () => {
            const spec = { type, config: nodeTypeDef(type).defaultConfig } as NodeSpec;
            const result = CompiledPipelineSchema.safeParse({
                id: 'p',
                workflowId: 'w',
                schemaVersion: 1,
                nodes: [{ id: 'n', ...spec }],
                edges: [],
            });
            expect(result.success).toBe(true);
        });
    }

    it('gives the switch node a default case', () => {
        const spec = { type: 'switch', config: nodeTypeDef('switch').defaultConfig } as NodeSpec;
        expect(spec.type).toBe('switch');
        if (spec.type === 'switch') {
            expect(spec.config.cases.length).toBeGreaterThan(0);
        }
    });
});
