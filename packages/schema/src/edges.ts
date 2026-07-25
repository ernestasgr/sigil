import { z } from 'zod';

import { NodeOutputPortIdSchema, PipelineEdgeIdSchema, PipelineNodeIdSchema } from './ids.js';

export const PipelineEdgeSchema = z.object({
    id: PipelineEdgeIdSchema,
    source: PipelineNodeIdSchema,
    target: PipelineNodeIdSchema,
    sourcePort: NodeOutputPortIdSchema,
});
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;
