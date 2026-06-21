import { z } from 'zod';
import { PipelineEdgeSchema } from './edges.js';
import { PipelineNodeSchema, outputPortsForNode } from './nodes.js';

export const PipelineSchemaVersionSchema = z.literal(1);
export type PipelineSchemaVersion = z.infer<typeof PipelineSchemaVersionSchema>;

export const CompiledPipelineSchema = z
    .object({
        id: z.string().min(1),
        workflowId: z.string().min(1),
        schemaVersion: PipelineSchemaVersionSchema,
        nodes: z.array(PipelineNodeSchema),
        edges: z.array(PipelineEdgeSchema),
    })
    .superRefine((pipeline, ctx) => {
        const nodeById = new Map<string, string>();
        for (const node of pipeline.nodes) {
            if (nodeById.has(node.id)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `Duplicate node id: "${node.id}"`,
                    path: ['nodes'],
                });
            }
            nodeById.set(node.id, node.id);
        }

        const edgeIds = new Set<string>();
        for (const edge of pipeline.edges) {
            if (edgeIds.has(edge.id)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `Duplicate edge id: "${edge.id}"`,
                    path: ['edges'],
                });
            }
            edgeIds.add(edge.id);

            const sourceNode = pipeline.nodes.find((n) => n.id === edge.source);
            if (!sourceNode) {
                ctx.addIssue({
                    code: 'custom',
                    message: `Edge "${edge.id}" references unknown source node: "${edge.source}"`,
                    path: ['edges'],
                });
                continue;
            }

            if (!pipeline.nodes.some((n) => n.id === edge.target)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `Edge "${edge.id}" references unknown target node: "${edge.target}"`,
                    path: ['edges'],
                });
            }

            const allowedPorts = outputPortsForNode(sourceNode);
            if (!allowedPorts.includes(edge.sourcePort)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `Edge "${edge.id}" has invalid sourcePort "${edge.sourcePort}" for node "${sourceNode.id}" (${sourceNode.type}). Allowed ports: ${allowedPorts.join(', ')}`,
                    path: ['edges'],
                });
            }
        }
    });

export type CompiledPipeline = z.infer<typeof CompiledPipelineSchema>;

export function parsePipeline(
    unknown: unknown,
): { ok: true; value: CompiledPipeline } | { ok: false; error: string } {
    const result = CompiledPipelineSchema.safeParse(unknown);
    if (result.success) {
        return { ok: true, value: result.data };
    }
    return {
        ok: false,
        error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
    };
}
