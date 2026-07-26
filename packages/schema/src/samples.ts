import {
    NodeOutputPortIdSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from './ids.js';
import type { CompiledPipeline } from './pipeline.js';

export const sampleManualTriggerToLog: CompiledPipeline = {
    id: 'sample-manual-trigger-to-log',
    workflowId: WorkflowIdSchema.parse('workflow-download-sorter'),
    schemaVersion: 1,
    nodes: [
        {
            id: PipelineNodeIdSchema.parse('trigger'),
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
            id: PipelineNodeIdSchema.parse('log'),
            type: 'log',
            config: {
                message: 'Manual trigger fired for {{payload.name}} ({{payload.size}} bytes)',
            },
        },
    ],
    edges: [
        {
            id: PipelineEdgeIdSchema.parse('trigger-to-log'),
            source: PipelineNodeIdSchema.parse('trigger'),
            target: PipelineNodeIdSchema.parse('log'),
            sourcePort: NodeOutputPortIdSchema.parse('out'),
        },
    ],
};
