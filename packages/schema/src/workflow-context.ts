import { z } from 'zod';
import { FileEventPayloadSchema } from './file-event-payload.js';

export const WorkflowContextSchema = z.object({
    event: FileEventPayloadSchema,
    vars: z.record(z.string(), z.unknown()),
});
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;
