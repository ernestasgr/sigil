import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { compileGraph } from '../../renderer/workflow-builder/compile.js';
import { createEngine } from '../core/engine.js';
import { workflowTopologyOptions } from '../workflow/workflow-acceptance.js';
import { createWorkflowActivator, type WorkflowActivator } from '../workflow/workflow-activator.js';
import { createWorkflowStore } from '../workflow/workflow-store.js';

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
            expect(loaded.value.executable.executionOrder).toEqual(['trigger', 'log']);

            const messages: string[] = [];
            engine.bus.subscribe((event) => {
                if (event.name === 'log.output') messages.push(event.payload.message);
            });
            await engine.execute(loaded.value.executable);

            expect(messages).toEqual(['from contract']);
            expect(activator.deactivate(summary.id)).toBe(true);
        } finally {
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });

    it('keeps two Workflows sharing the File Watcher Plugin independently active', async () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-trigger-lifecycle-'));
        const engine = createEngine();
        let activator: WorkflowActivator | undefined;

        try {
            await engine.loadBuiltinPlugins();

            const store = createWorkflowStore(
                storageDir,
                workflowTopologyOptions(engine.handlerRegistry, engine.contractRegistry),
            );
            const createFileWatcherPipeline = (
                pipelineId: string,
                workflowId: string,
            ): CompiledPipeline => ({
                id: pipelineId,
                workflowId,
                schemaVersion: 1,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'file-watcher',
                        config: {
                            path: storageDir,
                            recursive: false,
                            events: ['file.created'],
                            ignorePatterns: [],
                        },
                    },
                ],
                edges: [],
            });

            const first = store.create(
                'First File Watcher Workflow',
                createFileWatcherPipeline('pipeline-first', 'workflow-first'),
                {},
            );
            const second = store.create(
                'Second File Watcher Workflow',
                createFileWatcherPipeline('pipeline-second', 'workflow-second'),
                {},
            );

            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);
            expect(activator.activate(first.id)).toBe(true);
            expect(activator.activate(second.id)).toBe(true);

            await vi.waitFor(() => {
                expect(engine.fileWatcherManager.getSubscriberCount()).toBe(2);
            });

            expect(activator.deactivate(first.id)).toBe(true);
            await vi.waitFor(() => {
                expect(engine.fileWatcherManager.getSubscriberCount()).toBe(1);
            });
            expect(activator.isActive(second.id)).toBe(true);

            const startedPipelineIds: string[] = [];
            engine.bus.subscribe((event) => {
                if (event.name === 'workflow.started') {
                    startedPipelineIds.push(event.payload.pipelineId);
                }
            });
            writeFileSync(join(storageDir, 'after-first-deactivation.txt'), 'event');

            await vi.waitFor(() => {
                expect(startedPipelineIds).toContain('pipeline-second');
            });
            expect(startedPipelineIds).not.toContain('pipeline-first');

            expect(activator.deactivate(second.id)).toBe(true);
            await vi.waitFor(() => {
                expect(engine.fileWatcherManager.getSubscriberCount()).toBe(0);
            });
        } finally {
            activator?.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });
});
