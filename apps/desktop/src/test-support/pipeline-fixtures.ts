import type { CompiledPipeline } from '@sigil/schema';
import { type PipelineEdge, PipelineEdgeSchema } from '@sigil/schema/edges';
import {
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from '@sigil/schema/ids';
import { type PipelineNode, PipelineNodeSchema } from '@sigil/schema/nodes';

export const testNodeId = (value: string) => PipelineNodeIdSchema.parse(value);
export const testNodeType = (value: string) => NodeTypeNameSchema.parse(value);
export const testEdgeId = (value: string) => PipelineEdgeIdSchema.parse(value);
export const testPortId = (value: string) => NodeOutputPortIdSchema.parse(value);

export function testNode(value: unknown): PipelineNode {
    return PipelineNodeSchema.parse(value);
}

export function testEdge(value: unknown): PipelineEdge {
    return PipelineEdgeSchema.parse(value);
}

export function testPipeline(value: {
    readonly id: string;
    readonly workflowId: string;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}): CompiledPipeline {
    return {
        id: value.id,
        workflowId: WorkflowIdSchema.parse(value.workflowId),
        schemaVersion: 1,
        nodes: value.nodes.map(testNode),
        edges: value.edges.map(testEdge),
    };
}
