import { WorkflowDocumentSchema } from '@sigil/contracts';
import { sampleManualTriggerToLog } from '@sigil/workflow-domain/samples';
import { describe, expect, it } from 'vitest';

describe('renderer can import @sigil/contracts', () => {
    it('validates the sample pipeline', () => {
        const result = WorkflowDocumentSchema.safeParse(sampleManualTriggerToLog.source);
        expect(result.success).toBe(true);
    });
});
