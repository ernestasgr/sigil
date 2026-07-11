import type { CompiledPipeline } from '@sigil/schema';
import { describe, expect, it } from 'vitest';

import { compileGraph } from '../renderer/workflow-builder/compile.js';
import { createEngine } from './engine.js';

describe('Workflow topology contract', () => {
    it('reports the same empty-Pipeline rule from renderer compilation and Engine acceptance', async () => {
        const compiled = compileGraph([], [], { id: 'pipeline-1', workflowId: 'workflow-1' });

        expect(compiled.ok).toBe(false);
        if (!compiled.ok) {
            expect(compiled.diagnostics).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'empty_pipeline' })]),
            );
        }

        const engine = createEngine();
        const emptyPipeline: CompiledPipeline = {
            id: 'pipeline-1',
            workflowId: 'workflow-1',
            schemaVersion: 1,
            nodes: [],
            edges: [],
        };

        await expect(engine.execute(emptyPipeline)).rejects.toMatchObject({
            kind: 'workflow_topology',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({ code: 'empty_pipeline' }),
            ]),
        });
        engine.dispose();
    });
});
