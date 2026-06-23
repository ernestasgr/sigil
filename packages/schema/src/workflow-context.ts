import { z } from 'zod';

export const WorkflowContextSchema = z.object({
    event: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    vars: z.record(z.string(), z.unknown()),
});
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;
