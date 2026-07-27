import { WorkflowDocumentSchema } from '@sigil/contracts';
import { compileWorkflow } from '@sigil/workflow-domain';
import { describe, expect, it } from 'vitest';

describe('Node package façades', () => {
    it('loads contracts and workflow-domain from the public package entries', () => {
        const document = {
            id: 'public-import',
            workflowId: 'public-import',
            schemaVersion: 1,
            nodes: [],
            edges: [],
        };

        expect(WorkflowDocumentSchema.safeParse(document).success).toBe(true);
        expect(compileWorkflow(document)).toMatchObject({ ok: false, phase: 'admission' });
    });
});
