import { Option } from 'effect';

import type { WorkflowSummary } from '../shared/workflow.js';
import type { WorkflowActivator } from './workflow-activator.js';
import type { WorkflowStore } from './workflow-store.js';

export interface WorkflowLifecycle {
    readonly enable: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly retry: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly disable: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly toggle: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly activateEnabled: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly update: (workflowId: string, save: () => WorkflowSummary) => WorkflowSummary;
}

export function createWorkflowLifecycle(
    store: WorkflowStore,
    activator: WorkflowActivator,
): WorkflowLifecycle {
    function activateAndCommitIntent(workflowId: string): Option.Option<WorkflowSummary> {
        if (Option.isNone(store.getSummary(workflowId))) return Option.none();

        // The Trigger transition runs first. The persisted enabled intent is
        // committed only after that transition has produced either active or
        // failed activation state.
        activator.activate(workflowId);
        return store.setEnabled(workflowId, true);
    }

    function disableWorkflow(workflowId: string): Option.Option<WorkflowSummary> {
        if (Option.isNone(store.getSummary(workflowId))) return Option.none();
        activator.deactivate(workflowId);
        return store.setEnabled(workflowId, false);
    }

    function toggleWorkflow(workflowId: string): Option.Option<WorkflowSummary> {
        const current = store.getSummary(workflowId);
        if (Option.isNone(current)) return Option.none();
        return current.value.enabled
            ? disableWorkflow(workflowId)
            : activateAndCommitIntent(workflowId);
    }

    return {
        enable: activateAndCommitIntent,

        retry: activateAndCommitIntent,

        disable: disableWorkflow,

        toggle: toggleWorkflow,

        activateEnabled(workflowId: string): Option.Option<WorkflowSummary> {
            const current = store.getSummary(workflowId);
            if (Option.isNone(current) || !current.value.enabled) return current;
            activator.activate(workflowId);
            return store.getSummary(workflowId);
        },

        update(workflowId: string, save: () => WorkflowSummary): WorkflowSummary {
            const current = store.getSummary(workflowId);
            if (Option.isNone(current)) return save();

            const wasEnabled = current.value.enabled;
            const wasActivated = current.value.activation.kind !== 'disabled';
            if (wasActivated) activator.deactivate(workflowId);

            try {
                const saved = save();
                if (!wasEnabled) return saved;

                activator.activate(workflowId);
                const reactivated = store.setEnabled(workflowId, true);
                return Option.isSome(reactivated) ? reactivated.value : saved;
            } catch (error) {
                if (wasEnabled) {
                    activator.activate(workflowId);
                    store.setEnabled(workflowId, true);
                }
                throw error;
            }
        },
    };
}
