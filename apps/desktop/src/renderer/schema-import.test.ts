import { describe, expect, it } from 'vitest';
import { CompiledPipelineSchema } from '@sigil/schema';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';

describe('renderer can import @sigil/schema', () => {
    it('validates the sample pipeline', () => {
        const result = CompiledPipelineSchema.safeParse(sampleManualTriggerToLog);
        expect(result.success).toBe(true);
    });
});
