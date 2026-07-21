import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { createEngine } from '../core/engine.js';
import type { NodeRunResult, TriggerHandler } from '../node-handlers/types.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator, getDeactivationHook } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

describe('WorkflowActivator lifecycle', () => {
    it('tears down only the Workflow whose Trigger activation failed', () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-activator-lifecycle-'));
        const engine = createEngine();
        let activator: ReturnType<typeof createWorkflowActivator> | undefined;

        try {
            const callbacks: Array<(ctx: WorkflowContext) => void> = [];
            const teardowns: Array<ReturnType<typeof vi.fn>> = [];
            const triggerHandler: TriggerHandler = {
                activate: (_config, onEvent) => {
                    callbacks.push(onEvent);
                    const teardown = vi.fn((): void => {});
                    teardowns.push(teardown);
                    return teardown;
                },
                execute: async ({ ctx }): Promise<NodeRunResult> => ({
                    outputCtx: ctx,
                    activePort: 'out',
                }),
            };
            engine.handlerRegistry.register('test-trigger', triggerHandler);

            const store = createWorkflowStore(
                storageDir,
                workflowTopologyOptions(engine.handlerRegistry),
            );
            const createPipeline = (pipelineId: string, workflowId: string): CompiledPipeline => ({
                id: pipelineId,
                workflowId,
                schemaVersion: 1,
                nodes: [
                    {
                        id: 'trigger',
                        type: 'test-trigger',
                        pluginId: 'com.sigil.test-trigger',
                        config: {},
                    },
                ],
                edges: [],
            });
            const first = store.create(
                'First Workflow',
                createPipeline('pipeline-first', 'workflow-first'),
                {},
            );
            const second = store.create(
                'Second Workflow',
                createPipeline('pipeline-second', 'workflow-second'),
                {},
            );

            activator = createWorkflowActivator(engine, store, engine.handlerRegistry);
            expect(activator.activate(first.id)).toBe(true);
            expect(activator.activate(second.id)).toBe(true);
            expect(callbacks).toHaveLength(2);

            const secondCallback = callbacks[1];
            if (!secondCallback) throw new Error('second activation callback missing');
            const secondFailureHook = Option.getOrUndefined(getDeactivationHook(secondCallback));
            expect(secondFailureHook).toBeDefined();
            secondFailureHook?.();
            secondFailureHook?.();

            expect(teardowns[0]).not.toHaveBeenCalled();
            expect(teardowns[1]).toHaveBeenCalledTimes(1);
            expect(activator.activeWorkflowIds()).toEqual([first.id]);
            expect(activator.deactivate(second.id)).toBe(false);
        } finally {
            activator?.dispose();
            engine.dispose();
            rmSync(storageDir, { recursive: true, force: true });
        }
    });
});
