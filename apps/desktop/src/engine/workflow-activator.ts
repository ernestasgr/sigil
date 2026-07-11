import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';

import type { Engine } from './engine.js';
import { isTriggerHandler } from './node-handlers/types.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import type { WorkflowStore } from './workflow-store.js';

export interface WorkflowActivator {
    readonly activate: (workflowId: string) => boolean;
    readonly deactivate: (workflowId: string) => boolean;
    readonly isActive: (workflowId: string) => boolean;
    readonly activeWorkflowIds: () => readonly string[];
    readonly dispose: () => void;
}

const deactivationHooks = new WeakMap<(ctx: WorkflowContext) => void, () => void>();

export function getDeactivationHook(
    onEvent: (ctx: WorkflowContext) => void,
): Option.Option<() => void> {
    return Option.fromNullable(deactivationHooks.get(onEvent));
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
            if (Option.isNone(data)) return false;

            const trigger = data.value.executable.pipeline.nodes.find(
                (node) => node.id === data.value.executable.triggerId,
            );
            if (!trigger) return false;

            const handler = handlerRegistry.get(trigger.type);
            if (Option.isNone(handler)) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] no handler registered for trigger type "${trigger.type}" on "${data.value.name}" (${workflowId}) — cannot activate`,
                    },
                });
                return false;
            }

            if (!isTriggerHandler(handler.value)) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] node type "${trigger.type}" on "${data.value.name}" (${workflowId}) is not a trigger — cannot activate`,
                    },
                });
                return false;
            }

            const onEvent = (ctx: WorkflowContext): void => {
                void engine.execute(data.value.executable, ctx).catch((err: unknown) => {
                    engine.bus.next({
                        name: 'engine.diagnostic',
                        payload: {
                            message: `[activator] workflow ${data.value.name} (${workflowId}) execution failed: ${err instanceof Error ? err.message : String(err)}`,
                        },
                    });
                });
            };
            deactivationHooks.set(onEvent, (): void => {
                if (!active.has(workflowId)) return;
                active.delete(workflowId);
                store.setEnabled(workflowId, false);
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] trigger "${trigger.type}" disabled for "${data.value.name}" (${workflowId}) — activation failed in worker`,
                    },
                });
                onStateChange?.();
            });

            try {
                const teardown = handler.value.activate(trigger.config, onEvent);
                active.set(workflowId, teardown);
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] trigger "${trigger.type}" active for "${data.value.name}" (${workflowId})`,
                    },
                });
                return true;
            } catch (err) {
                engine.bus.next({
                    name: 'engine.diagnostic',
                    payload: {
                        message: `[activator] failed to activate trigger "${trigger.type}" for "${data.value.name}" (${workflowId}): ${err instanceof Error ? err.message : String(err)}`,
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
