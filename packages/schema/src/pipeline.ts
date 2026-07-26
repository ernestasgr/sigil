import { z } from 'zod';

import { PipelineEdgeSchema } from './edges.js';
import { WorkflowIdSchema } from './ids.js';
import { PipelineNodeSchema } from './nodes/index.js';

export const PipelineSchemaVersionSchema = z.literal(1);
export type PipelineSchemaVersion = z.infer<typeof PipelineSchemaVersionSchema>;

/**
 * The persisted graph shape. Referential integrity, contract admission, and
 * DAG rules belong to topology validation so editors can represent drafts.
 */
export const PipelineDocumentSchema = z
    .object({
        id: z.string().min(1),
        workflowId: WorkflowIdSchema,
        schemaVersion: PipelineSchemaVersionSchema,
        nodes: z.array(PipelineNodeSchema).readonly(),
        edges: z.array(PipelineEdgeSchema).readonly(),
    })
    .strict()
    .readonly();

export type PipelineDocument = z.infer<typeof PipelineDocumentSchema>;

/** Public execution name retained as an alias for the structural document. */
export const CompiledPipelineSchema = PipelineDocumentSchema;
export type CompiledPipeline = PipelineDocument;

function formatPipelineIssue(
    issue: z.core.$ZodIssue,
    parentPath: readonly PropertyKey[] = [],
): readonly string[] {
    const path = [...parentPath, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors.length > 0) {
        return issue.errors.flatMap((branch) =>
            branch.flatMap((nestedIssue) => formatPipelineIssue(nestedIssue, path)),
        );
    }
    return [`${path.join('.')}: ${issue.message}`];
}

export function parsePipelineDocument(
    unknown: unknown,
): { ok: true; value: PipelineDocument } | { ok: false; error: string } {
    const result = PipelineDocumentSchema.safeParse(unknown);
    if (result.success) {
        return { ok: true, value: result.data };
    }
    return {
        ok: false,
        error: result.error.issues.flatMap((issue) => formatPipelineIssue(issue)).join('\n'),
    };
}

/** Compatibility alias for callers that use the parser as the schema seam. */
export const parsePipeline = parsePipelineDocument;

export type { NodeOutputPortId, PipelineEdgeId, PipelineNodeId } from './ids.js';
export { NodeOutputPortIdSchema, PipelineEdgeIdSchema, PipelineNodeIdSchema } from './ids.js';
export type {
    ExecutableWorkflow,
    TopologyDiagnostic,
    TopologyDiagnosticCode,
    TopologyDiagnosticSeverity,
    WorkflowTopologyOptions,
    WorkflowTopologyResult,
} from './topology.js';
export { formatTopologyDiagnostics, validateWorkflowTopology } from './topology.js';
