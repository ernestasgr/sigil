import type { WorkflowSummary } from '../shared/workflow.js';

export type WorkflowRegistryState = readonly Pick<WorkflowSummary, 'id' | 'name' | 'enabled'>[];

export function toggleWorkflow(state: WorkflowRegistryState, id: string): WorkflowRegistryState {
    const workflow = state.find((w) => w.id === id);
    if (!workflow) return state;

    return state.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w));
}

export function anyEnabled(state: WorkflowRegistryState): boolean {
    return state.some((w) => w.enabled);
}
