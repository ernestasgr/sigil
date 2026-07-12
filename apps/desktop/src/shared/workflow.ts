import { TopologyDiagnosticSchema } from '@sigil/schema/topology';
import { z } from 'zod';

export { WorkflowIdSchema } from '@sigil/schema/workflow-id';

export const WorkflowActivationStateSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('disabled') }).readonly(),
    z.object({ kind: z.literal('activating') }).readonly(),
    z.object({ kind: z.literal('active') }).readonly(),
    z.object({ kind: z.literal('failed'), message: z.string() }).readonly(),
]);

export type WorkflowActivationState = z.infer<typeof WorkflowActivationStateSchema>;

export const WorkflowSummarySchema = z
    .object({
        // Startup diagnostics may expose an invalid filename id for recovery.
        id: z.string(),
        name: z.string(),
        /** The user's persisted intent, independent from live trigger activation. */
        enabled: z.boolean(),
        activation: WorkflowActivationStateSchema.default({ kind: 'disabled' }),
        diagnostics: z.array(TopologyDiagnosticSchema).readonly().optional(),
    })
    .readonly();

export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow activation state: ${JSON.stringify(value)}`);
}

export function isWorkflowActive(workflow: Pick<WorkflowSummary, 'activation'>): boolean {
    return workflow.activation.kind === 'active';
}

export function workflowActivationLabel(activation: WorkflowActivationState): string {
    switch (activation.kind) {
        case 'disabled':
            return 'Disabled';
        case 'activating':
            return 'Activating';
        case 'active':
            return 'Active';
        case 'failed':
            return `Activation failed: ${activation.message}`;
        default:
            return assertNever(activation);
    }
}

export interface NodePosition {
    readonly x: number;
    readonly y: number;
}
