import { describe, expect, it } from 'vitest';

import { WorkflowIdSchema } from './workflow-id.js';

describe('WorkflowIdSchema', () => {
    it.each([
        ['workflow-123_v2', true],
        ['', false],
        ['../outside', false],
        ['..\\outside', false],
        ['/tmp/outside', false],
        ['C:\\tmp\\outside', false],
        ['_starts-with-underscore', false],
        ['-starts-with-hyphen', false],
        ['workflow.v1', false],
        ['a'.repeat(128), true],
        ['a'.repeat(129), false],
    ] as const)('validates Workflow identifier %j', (value, expected) => {
        expect(WorkflowIdSchema.safeParse(value).success).toBe(expected);
    });
});
