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

/** The unique identifier of a Plugin (e.g. "com.sigil.file-watcher"). */
export const PluginIdSchema = z.string().min(1).brand<'PluginId'>();
export type PluginId = z.infer<typeof PluginIdSchema>;

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const WorkflowIdSchema = z
    .string()
    .min(1, 'Workflow id must not be empty.')
    .max(128, 'Workflow id must be at most 128 characters.')
    .regex(
        WORKFLOW_ID_PATTERN,
        'Workflow id must contain only letters, numbers, hyphens, and underscores, and start with a letter or number.',
    )
    .brand<'WorkflowId'>();

export type WorkflowId = z.infer<typeof WorkflowIdSchema>;
