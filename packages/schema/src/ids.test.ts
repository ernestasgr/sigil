import { describe, expect, it } from 'vitest';

import {
    EventNameSchema,
    MAX_CANONICAL_ID_LENGTH,
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    PluginIdSchema,
    SwitchCaseIdSchema,
} from './ids.js';

describe('canonical identity schemas', () => {
    it('rejects Plugin IDs that are not lowercase namespaced identities', () => {
        expect(PluginIdSchema.safeParse('Com.Sigil.Plugin').success).toBe(false);
    });

    it('accepts canonical Plugin, Event, Node type, and graph identities', () => {
        expect(PluginIdSchema.safeParse('com.sigil.file-watcher').success).toBe(true);
        expect(EventNameSchema.safeParse('file.created').success).toBe(true);
        expect(NodeTypeNameSchema.safeParse('file-watcher').success).toBe(true);
        expect(PipelineNodeIdSchema.safeParse('node-1').success).toBe(true);
        expect(PipelineEdgeIdSchema.safeParse('node-1-to-node-2').success).toBe(true);
        expect(NodeOutputPortIdSchema.safeParse('case-1').success).toBe(true);
        expect(SwitchCaseIdSchema.safeParse('case-1').success).toBe(true);
    });

    it('rejects empty, whitespace, control, noncanonical, and overlong identities', () => {
        for (const schema of [PluginIdSchema, EventNameSchema, NodeTypeNameSchema]) {
            expect(schema.safeParse('').success).toBe(false);
            expect(schema.safeParse('   ').success).toBe(false);
        }

        const invalidValues = [
            '',
            '   ',
            ' file.created',
            'file.created ',
            'file.\ncreated',
            'file.\u0085created',
            'File.Created',
        ];
        for (const value of invalidValues) {
            expect(EventNameSchema.safeParse(value).success).toBe(false);
        }

        expect(NodeTypeNameSchema.safeParse('a'.repeat(MAX_CANONICAL_ID_LENGTH + 1)).success).toBe(
            false,
        );
        expect(NodeTypeNameSchema.safeParse('a'.repeat(MAX_CANONICAL_ID_LENGTH)).success).toBe(
            true,
        );
    });

    it('applies the same canonical boundaries to Plugin IDs, Events, and Node types', () => {
        const cases = [
            {
                schema: PluginIdSchema,
                valid: 'a.'.concat('a'.repeat(MAX_CANONICAL_ID_LENGTH - 2)),
                invalid: 'com.sigil.plugin',
            },
            {
                schema: EventNameSchema,
                valid: 'a.'.concat('a'.repeat(MAX_CANONICAL_ID_LENGTH - 2)),
                invalid: 'custom.event',
            },
            {
                schema: NodeTypeNameSchema,
                valid: 'a'.repeat(MAX_CANONICAL_ID_LENGTH),
                invalid: 'custom-node',
            },
        ] as const;

        for (const { schema, valid, invalid } of cases) {
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse(`${valid}a`).success).toBe(false);
            expect(schema.safeParse(` ${invalid}`).success).toBe(false);
            expect(schema.safeParse(`${invalid} `).success).toBe(false);
            expect(schema.safeParse(invalid.toUpperCase()).success).toBe(false);
            expect(schema.safeParse(`${invalid}\u0000x`).success).toBe(false);
        }
    });
});
