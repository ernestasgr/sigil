import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';

import type { WorkflowActivationState } from '../shared/workflow.js';
import type { Engine } from './engine.js';
import { isTriggerHandler } from './node-handlers/types.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import { acceptWorkflow } from './workflow-acceptance.js';
import type { WorkflowStore } from './workflow-store.js';

export interface WorkflowActivator {
    readonly activate: (workflowId: string) => boolean;
    readonly deactivate: (workflowId: string) => boolean;
    readonly isActive: (workflowId: string) => boolean;
    readonly activeWorkflowIds: () => readonly string[];
    readonly dispose: () => void;
}

type WorkflowEventCallback = (ctx: WorkflowContext) => void;

interface ActiveActivation {
    readonly token: number;
    readonly onEvent: WorkflowEventCallback;
    readonly teardown: () => void;
}

const deactivationHooks = new WeakMap<WorkflowEventCallback, (reason?: string) => void>();

export function getDeactivationHook(
    onEvent: WorkflowEventCallback,
): Option.Option<(reason?: string) => void> {
    return Option.fromNullable(deactivationHooks.get(onEvent));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function disabledState(): WorkflowActivationState {
    return { kind: 'disabled' };
}

export function createWorkflowActivator(
    engine: Engine,
    store: WorkflowStore,
    handlerRegistry: NodeHandlerRegistry,
    onStateChange?: () => void,
): WorkflowActivator {
    const active = new Map<string, ActiveActivation>();
    let nextToken = 0;

    function setActivation(workflowId: string, activation: WorkflowActivationState): void {
        store.setActivation(workflowId, activation);
    }

    function emitDiagnostic(message: string, kind?: string): void {
        engine.bus.next({
            name: 'engine.diagnostic',
            payload: kind ? { kind, message } : { message },
        });
    }

    function recordFailure(
        workflowId: string,
        message: string,
        diagnostic: string,
        publishStateChange: boolean,
    ): void {
        setActivation(workflowId, { kind: 'failed', message });
        emitDiagnostic(diagnostic, 'workflow_activation');
        if (publishStateChange) onStateChange?.();
    }

    return {
        activate(workflowId: string): boolean {
            if (active.has(workflowId)) return true;

            const data = store.get(workflowId);
            if (Option.isNone(data)) return false;

            setActivation(workflowId, { kind: 'activating' });

            const accepted = acceptWorkflow(data.value.executable, handlerRegistry);
            if (!accepted.ok) {
                for (const diagnostic of accepted.diagnostics) {
                    engine.bus.next({
                        name: 'engine.diagnostic',
                        payload: {
                            kind: 'workflow_topology',
                            message: `[activator][topology:${diagnostic.code}] ${diagnostic.message}`,
                        },
                    });
                }
                const firstDiagnostic = accepted.diagnostics[0];
                recordFailure(
                    workflowId,
                    firstDiagnostic?.message ?? 'Workflow topology validation failed.',
                    `[activator] failed to activate workflow "${data.value.name}" (${workflowId}): workflow topology is invalid`,
                    false,
                );
                return false;
            }

            const executable = accepted.value;
            const trigger = executable.pipeline.nodes.find(
                (node) => node.id === executable.triggerId,
            );
            if (!trigger) {
                recordFailure(
                    workflowId,
                    'The executable Workflow has no Trigger node.',
                    `[activator] failed to activate workflow "${data.value.name}" (${workflowId}): trigger node is missing`,
                    false,
                );
                return false;
            }

            const handler = handlerRegistry.get(trigger.type);
            if (Option.isNone(handler)) {
                const message = `No handler registered for trigger type "${trigger.type}".`;
                recordFailure(
                    workflowId,
                    message,
                    `[activator] no handler registered for trigger type "${trigger.type}" on "${data.value.name}" (${workflowId}) — cannot activate`,
                    false,
                );
                return false;
            }

            if (!isTriggerHandler(handler.value)) {
                const message = `Node type "${trigger.type}" is not a Trigger.`;
                recordFailure(
                    workflowId,
                    message,
                    `[activator] node type "${trigger.type}" on "${data.value.name}" (${workflowId}) is not a trigger — cannot activate`,
                    false,
                );
                return false;
            }

            const token = nextToken++;
            const onEvent: WorkflowEventCallback = (ctx): void => {
                void engine.execute(executable, ctx).catch((err: unknown) => {
                    emitDiagnostic(
                        `[activator] workflow ${data.value.name} (${workflowId}) execution failed: ${errorMessage(err)}`,
                    );
                });
            };

            const handleActivationFailure = (reason?: string): void => {
                const current = active.get(workflowId);
                if (!current || current.token !== token) return;

                active.delete(workflowId);
                deactivationHooks.delete(onEvent);
                current.teardown();
                recordFailure(
                    workflowId,
                    reason ?? 'The Trigger worker failed during activation.',
                    `[activator] trigger "${trigger.type}" disabled for "${data.value.name}" (${workflowId}) — activation failed in worker${reason ? `: ${reason}` : ''}`,
                    true,
                );
            };
            deactivationHooks.set(onEvent, handleActivationFailure);

            try {
                const teardown = handler.value.activate(trigger.config, onEvent);
                active.set(workflowId, { token, onEvent, teardown });
                setActivation(workflowId, { kind: 'active' });
                emitDiagnostic(
                    `[activator] trigger "${trigger.type}" active for "${data.value.name}" (${workflowId})`,
                    'workflow_activation',
                );
                return true;
            } catch (err) {
                deactivationHooks.delete(onEvent);
                recordFailure(
                    workflowId,
                    errorMessage(err),
                    `[activator] failed to activate trigger "${trigger.type}" for "${data.value.name}" (${workflowId}): ${errorMessage(err)}`,
                    false,
                );
                return false;
            }
        },

        deactivate(workflowId: string): boolean {
            const activation = active.get(workflowId);
            if (activation) {
                active.delete(workflowId);
                deactivationHooks.delete(activation.onEvent);
                activation.teardown();
                setActivation(workflowId, disabledState());
                return true;
            }

            const summary = store.getSummary(workflowId);
            if (Option.isSome(summary) && summary.value.activation.kind !== 'disabled') {
                setActivation(workflowId, disabledState());
            }
            return false;
        },

        isActive(workflowId: string): boolean {
            return active.has(workflowId);
        },

        activeWorkflowIds(): readonly string[] {
            return [...active.keys()];
        },

        dispose(): void {
            for (const workflowId of [...active.keys()]) {
                const activation = active.get(workflowId);
                if (activation) {
                    deactivationHooks.delete(activation.onEvent);
                    activation.teardown();
                }
                active.delete(workflowId);
                setActivation(workflowId, disabledState());
            }
        },
    };
}
