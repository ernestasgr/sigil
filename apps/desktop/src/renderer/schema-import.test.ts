import { WorkflowDocumentSchema } from '@sigil/schema';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import { describe, expect, it } from 'vitest';

describe('renderer can import @sigil/schema', () => {
    it('validates the sample pipeline', () => {
        const result = WorkflowDocumentSchema.safeParse(sampleManualTriggerToLog.source);
        expect(result.success).toBe(true);
    });
});
