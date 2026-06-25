export interface WorkflowSummary {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
}

export interface NodePosition {
    readonly x: number;
    readonly y: number;
}
