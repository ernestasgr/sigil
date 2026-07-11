import { z } from 'zod';

export const WorkflowContextSchema = z.object({
    // An empty event is the valid seed context for nodes that do not require
    // an external trigger. Trigger handlers enforce their own requirement.
    event: z.string(),
    payload: z.record(z.string(), z.unknown()),
    vars: z.record(z.string(), z.unknown()),
});
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;
