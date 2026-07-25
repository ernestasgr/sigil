import { z } from 'zod';

/** The identity of a concrete node instance in a Pipeline graph. */
export const PipelineNodeIdSchema = z.string().min(1).brand<'PipelineNodeId'>();
export type PipelineNodeId = z.infer<typeof PipelineNodeIdSchema>;

/** The identity of a concrete Edge instance in a Pipeline graph. */
export const PipelineEdgeIdSchema = z.string().min(1).brand<'PipelineEdgeId'>();
export type PipelineEdgeId = z.infer<typeof PipelineEdgeIdSchema>;

/** The stable identity of a Node Contract output port. */
export const NodeOutputPortIdSchema = z.string().min(1).brand<'NodeOutputPortId'>();
export type NodeOutputPortId = z.infer<typeof NodeOutputPortIdSchema>;
