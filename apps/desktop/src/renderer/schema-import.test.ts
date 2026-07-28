import { WorkflowDocumentSchema } from '@sigil/contracts';
import { FileEventPayloadSchema } from '@sigil/contracts/events';
import { PipelineNodeSchema } from '@sigil/contracts/workflow';
import { getBuiltinNodeContract } from '@sigil/workflow-domain';
import { describe, expect, it } from 'vitest';
import { testManualTriggerToLog } from '../test-support/pipeline-fixtures.js';

describe('public contract facades', () => {
    it('validate a Workflow document and its Node payloads', () => {
        const result = WorkflowDocumentSchema.safeParse(testManualTriggerToLog.source);
        expect(result.success).toBe(true);
        expect(PipelineNodeSchema.safeParse(testManualTriggerToLog.source.nodes[0]).success).toBe(
            true,
        );
        expect(
            FileEventPayloadSchema.safeParse({
                path: '/tmp/report.pdf',
                name: 'report.pdf',
                ext: 'pdf',
                size: 1,
                dir: '/tmp',
            }).success,
        ).toBe(true);
    });

    it('loads Workflow domain admission through its root facade', () => {
        expect(getBuiltinNodeContract('manual-trigger').role).toBe('trigger');
    });
});
