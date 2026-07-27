import { FileEventNameSchema } from '@sigil/contracts/event-catalog';
import {
    NodeOutputPortIdSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import { compileWorkflow } from './compilation.js';

const sampleDocument = {
    id: 'sample-manual-trigger-to-log',
    workflowId: WorkflowIdSchema.parse('workflow-download-sorter'),
    schemaVersion: 1,
    nodes: [
        {
            id: PipelineNodeIdSchema.parse('trigger'),
            type: 'manual-trigger',
            config: {
                eventName: FileEventNameSchema.parse('file.created'),
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
} as const;

const compiledSample = compileWorkflow(sampleDocument);
if (!compiledSample.ok) {
    throw new Error(`Invalid sample Workflow document: ${compiledSample.error}`);
}

export const sampleManualTriggerToLog = compiledSample.value;
