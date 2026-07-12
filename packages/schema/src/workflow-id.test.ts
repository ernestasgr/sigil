import { describe, expect, it } from 'vitest';

import { WorkflowIdSchema } from './workflow-id.js';

describe('WorkflowIdSchema', () => {
    it('accepts a safe Workflow identifier', () => {
        expect(WorkflowIdSchema.safeParse('workflow-123_v2').success).toBe(true);
    });

    it.each([
        '',
        '../outside',
        '..\\outside',
        '/tmp/outside',
        'C:\\tmp\\outside',
    ])('rejects unsafe Workflow identifier %j', (value) => {
        expect(WorkflowIdSchema.safeParse(value).success).toBe(false);
    });
});
