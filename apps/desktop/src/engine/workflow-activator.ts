import type { CompiledPipeline } from '@sigil/schema';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { Engine } from './engine.js';
import type { FileWatcherManager } from './file-watcher-manager.js';
import type { WorkflowStore } from './workflow-store.js';

export interface WorkflowActivator {
    readonly activate: (workflowId: string) => boolean;
    readonly deactivate: (workflowId: string) => boolean;
    readonly isActive: (workflowId: string) => boolean;
    readonly activeWorkflowIds: () => readonly string[];
    readonly dispose: () => void;
}

export function createWorkflowActivator(
    engine: Engine,
    store: WorkflowStore,
    fileWatcherManager: FileWatcherManager,
): WorkflowActivator {
    const active = new Map<string, () => void>();

    return {
        activate(workflowId: string): boolean {
            if (active.has(workflowId)) return true;

            const data = store.get(workflowId);
            if (!data) return false;

            const trigger = data.pipeline.nodes[0];
            if (!trigger) return false;

            let teardown: () => void;

            switch (trigger.type) {
                case 'file-watcher': {
                    const config = trigger.config as {
                        path: string;
                        recursive: boolean;
                        events: readonly string[];
                        ignorePatterns?: readonly string[] | undefined;
                    };
                    const subscriberId = `workflow:${workflowId}`;

                    fileWatcherManager.registerSubscriber(
                        {
                            id: subscriberId,
                            path: config.path,
                            recursive: config.recursive,
                            events: config.events,
                            ignorePatterns: config.ignorePatterns,
                        },
                        (fileEvent) => {
                            const seedCtx: WorkflowContext = {
                                event: fileEvent.eventName,
                                payload: fileEvent.payload as Record<string, unknown>,
                                vars: {},
                            };
                            void engine
                                .execute(data.pipeline as CompiledPipeline, seedCtx)
                                .catch((err: unknown) => {
                                    engine.bus.next({
                                        name: 'log.output',
                                        payload: {
                                            message: `[activator] workflow ${data.name} (${workflowId}) execution failed: ${err instanceof Error ? err.message : String(err)}`,
                                        },
                                    });
                                });
                        },
                    );

                    teardown = () => {
                        fileWatcherManager.unregisterSubscriber(subscriberId);
                    };

                    engine.bus.next({
                        name: 'log.output',
                        payload: {
                            message: `[activator] file-watcher trigger active for "${data.name}" — watching ${config.path}`,
                        },
                    });
                    break;
                }
                case 'manual-trigger': {
                    engine.bus.next({
                        name: 'log.output',
                        payload: {
                            message: `[activator] manual trigger ready for "${data.name}"`,
                        },
                    });
                    teardown = () => {};
                    break;
                }
                default: {
                    engine.bus.next({
                        name: 'log.output',
                        payload: {
                            message: `[activator] unknown trigger type "${trigger.type}" for "${data.name}" — cannot activate`,
                        },
                    });
                    return false;
                }
            }

            active.set(workflowId, teardown);
            return true;
        },

        deactivate(workflowId: string): boolean {
            const teardown = active.get(workflowId);
            if (!teardown) return false;
            teardown();
            active.delete(workflowId);
            return true;
        },

        isActive(workflowId: string): boolean {
            return active.has(workflowId);
        },

        activeWorkflowIds(): readonly string[] {
            return [...active.keys()];
        },

        dispose(): void {
            for (const [id, teardown] of active) {
                teardown();
                active.delete(id);
            }
        },
    };
}
