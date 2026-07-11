import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileGraph } from '../renderer/workflow-builder/compile.js';
import { createEngine } from './engine.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

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

    it('preserves the Builder-selected Trigger through stored load and manual execution', async () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-topology-contract-'));
        const engine = createEngine();

        try {
            const compiled = compileGraph(
                [
                    { id: 'log', data: { type: 'log', config: { message: 'from contract' } } },
                    {
                        id: 'trigger',
                        data: {
                            type: 'manual-trigger',
                            config: {
                                eventName: 'file.created',
                                payload: {
                                    path: '/tmp/file.txt',
                                    name: 'file.txt',
                                    ext: 'txt',
                                    size: 1,
                                    dir: '/tmp',
                                },
                            },
                        },
                    },
                ],
                [{ id: 'trigger-log', source: 'trigger', target: 'log', sourceHandle: 'out' }],
                { id: 'pipeline-contract', workflowId: 'workflow-contract' },
            );

            expect(compiled.ok).toBe(true);
            if (!compiled.ok) return;
            expect(compiled.executable.triggerId).toBe('trigger');

            const store = createWorkflowStore(storageDir);
            const summary = store.create('Contract Workflow', compiled.value, {});
            const loadedStore = createWorkflowStore(storageDir);
            const loaded = loadedStore.get(summary.id);
            expect(Option.isSome(loaded)).toBe(true);
            if (Option.isNone(loaded)) return;
            expect(loaded.value.executable.triggerId).toBe('trigger');

            const activator = createWorkflowActivator(engine, loadedStore, engine.handlerRegistry);
            expect(activator.activate(summary.id)).toBe(true);
            expect(activator.activeWorkflowIds()).toEqual([summary.id]);
            expect(activator.deactivate(summary.id)).toBe(true);

            const messages: string[] = [];
            engine.bus.subscribe((event) => {
                if (event.name === 'log.output') messages.push(event.payload.message);
            });
            await engine.execute(loaded.value.executable);

            expect(messages).toEqual(['from contract']);
        } finally {
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });
});
