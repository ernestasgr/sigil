import type { CompiledPipeline } from './pipeline.js';

export const sampleManualTriggerToLog: CompiledPipeline = {
    id: 'sample-manual-trigger-to-log',
    workflowId: 'workflow-download-sorter',
    schemaVersion: 1,
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
};
