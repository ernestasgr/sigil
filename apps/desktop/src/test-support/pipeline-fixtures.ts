import type { WorkflowDocument } from '@sigil/contracts';
import {
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import {
    type PipelineEdge,
    PipelineEdgeSchema,
    type PipelineNode,
    PipelineNodeSchema,
} from '@sigil/contracts/workflow';
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

export const testManualTriggerToLog = testPipeline({
    id: 'sample-manual-trigger-to-log',
    workflowId: 'workflow-download-sorter',
    nodes: [
        {
            id: 'trigger',
            type: 'manual-trigger',
            config: {
                eventName: 'file.created',
                payload: {
                    path: '/Users/dev/Downloads/report.pdf',
                    name: 'report.pdf',
                    ext: 'pdf',
                    size: 2048576,
                    dir: '/Users/dev/Downloads',
                },
            },
        },
        {
            id: 'log',
            type: 'log',
            config: {
                message: 'Manual trigger fired for {{payload.name}} ({{payload.size}} bytes)',
            },
        },
    ],
    edges: [
        {
            id: 'trigger-to-log',
            source: 'trigger',
            target: 'log',
            sourcePort: 'out',
        },
    ],
});
