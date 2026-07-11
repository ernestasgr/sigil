import type { TopologyDiagnostic } from '@sigil/schema/topology';

export interface WorkflowSummary {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly diagnostics?: readonly TopologyDiagnostic[];
}

export interface NodePosition {
    readonly x: number;
    readonly y: number;
}
