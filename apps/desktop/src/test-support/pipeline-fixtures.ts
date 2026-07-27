import type { WorkflowDocument } from '@sigil/contracts';
import { type PipelineEdge, PipelineEdgeSchema } from '@sigil/contracts/edges';
import {
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import { type PipelineNode, PipelineNodeSchema } from '@sigil/contracts/nodes';
import { type CompiledPipeline, compileWorkflow } from '@sigil/workflow-domain';

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

export function testDocument(value: {
    readonly id: string;
    readonly workflowId: string;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}): WorkflowDocument {
    return {
        id: value.id,
        workflowId: WorkflowIdSchema.parse(value.workflowId),
        schemaVersion: 1,
        nodes: value.nodes.map(testNode),
        edges: value.edges.map(testEdge),
    };
}

export function testPipeline(value: {
    readonly id: string;
    readonly workflowId: string;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}): CompiledPipeline {
    const result = compileWorkflow(testDocument(value));
    if (!result.ok) throw new Error(result.error);
    return result.value;
}
