import { z } from 'zod';

export const PipelineEdgeSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourcePort: z.string().min(1),
});
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;
