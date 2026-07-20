import { formatTopologyDiagnostics, type TopologyDiagnostic } from '@sigil/schema/topology';

export type WorkflowTopologyError = Error & {
    readonly kind: 'workflow_topology';
    readonly diagnostics: readonly TopologyDiagnostic[];
};

export function createWorkflowTopologyError(
    diagnostics: readonly TopologyDiagnostic[],
): WorkflowTopologyError {
    return Object.assign(new Error(formatTopologyDiagnostics(diagnostics)), {
        name: 'WorkflowTopologyError',
        kind: 'workflow_topology' as const,
        diagnostics,
    });
}

export function isWorkflowTopologyError(error: unknown): error is WorkflowTopologyError {
    if (typeof error !== 'object' || error === null) return false;
    if (!('kind' in error) || error.kind !== 'workflow_topology') return false;
    return 'diagnostics' in error && Array.isArray(error.diagnostics);
}
