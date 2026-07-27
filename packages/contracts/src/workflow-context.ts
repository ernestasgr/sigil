import { z } from 'zod';
import { CanonicalEventNameSchema } from './ids.js';

export const WorkflowContextSchema = z
    .object({
        // An empty event is the valid seed context for nodes that do not require
        // an external trigger. Trigger handlers enforce their own requirement.
        event: z.union([z.literal(''), CanonicalEventNameSchema]),
        payload: z.record(z.string(), z.unknown()),
        vars: z.record(z.string(), z.unknown()),
    })
    .strict()
    .readonly();
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;
