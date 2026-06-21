import type { WorkflowSummary } from '../shared/workflow.js';

export type TrayMenuItem =
    | { readonly kind: 'workflow-toggle'; readonly workflow: WorkflowSummary }
    | { readonly kind: 'no-workflows' }
    | { readonly kind: 'open-app' }
    | { readonly kind: 'separator' }
    | { readonly kind: 'quit' };

export interface TrayMenu {
    readonly workflowsActive: boolean;
    readonly items: readonly TrayMenuItem[];
}

export function buildTrayMenu(workflows: readonly WorkflowSummary[]): TrayMenu {
    const workflowItems: TrayMenuItem[] = workflows.map((w) => ({
        kind: 'workflow-toggle',
        workflow: w,
    }));
    const emptyItem: TrayMenuItem[] = workflows.length === 0 ? [{ kind: 'no-workflows' }] : [];

    return {
        workflowsActive: workflows.some((w) => w.enabled),
        items: [
            ...workflowItems,
            ...emptyItem,
            { kind: 'separator' },
            { kind: 'open-app' },
            { kind: 'separator' },
            { kind: 'quit' },
        ],
    };
}
