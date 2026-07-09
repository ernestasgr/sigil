import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { Engine } from './engine.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import { isTriggerHandler } from './node-handlers/types.js';
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
    handlerRegistry: NodeHandlerRegistry,
    onStateChange?: () => void,
): WorkflowActivator {
    const active = new Map<string, () => void>();

    return {
        activate(workflowId: string): boolean {
            if (active.has(workflowId)) return true;

            const data = store.get(workflowId);
            if (!data) return false;

            const trigger = data.pipeline.nodes[0];
            if (!trigger) return false;

            const handler = handlerRegistry.get(trigger.type);
            if (!handler) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] no handler registered for trigger type "${trigger.type}" on "${data.name}" (${workflowId}) — cannot activate`,
                    },
                });
                return false;
            }

            if (!isTriggerHandler(handler)) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] node type "${trigger.type}" on "${data.name}" (${workflowId}) is not a trigger — cannot activate`,
                    },
                });
                return false;
            }

            const onEvent = (ctx: WorkflowContext): void => {
                void engine.execute(data.pipeline, ctx).catch((err: unknown) => {
                    engine.bus.next({
                        name: 'engine.diagnostic',
                        payload: {
                            message: `[activator] workflow ${data.name} (${workflowId}) execution failed: ${err instanceof Error ? err.message : String(err)}`,
                        },
                    });
                });
            };
            (onEvent as unknown as { _deactivate: () => void })._deactivate = (): void => {
                active.delete(workflowId);
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] trigger "${trigger.type}" deactivated for "${data.name}" (${workflowId}) — activation failed in worker`,
                    },
                });
                onStateChange?.();
            };

            try {
                const teardown = handler.activate(trigger.config, onEvent);
                active.set(workflowId, teardown);
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] trigger "${trigger.type}" active for "${data.name}" (${workflowId})`,
                    },
                });
                return true;
            } catch (err) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] failed to activate trigger "${trigger.type}" for "${data.name}" (${workflowId}): ${err instanceof Error ? err.message : String(err)}`,
                    },
                });
                return false;
            }
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
