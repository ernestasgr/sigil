import { describe, expect, it } from 'vitest';
import {
    NodeOutputPortIdSchema,
    PipelineEdgeIdSchema,
    PipelineNodeIdSchema,
    PluginIdSchema,
} from './ids.js';
import {
    createBuiltinNodeContractRegistry,
    getBuiltinNodeContract,
    pluginNodeIdentity,
    registerSerializableNodeContract,
} from './node-contract.js';
import { FileWatcherDescriptor } from './nodes/file-watcher.js';
import type { PersistedPipeline } from './pipeline.js';
import { WorkflowIdSchema } from './workflow-id.js';
import { migrateWorkflowContracts } from './workflow-migration.js';

const pid = (id: string) => PluginIdSchema.parse(id);

describe('Workflow contract migrations', () => {
    it('migrates legacy bundled identities and aliased ports with an idempotent audit report', () => {
        const registry = createBuiltinNodeContractRegistry();
        const legacyContract = getBuiltinNodeContract('file-watcher');
        registerSerializableNodeContract(registry, {
            ...legacyContract,
            identity: pluginNodeIdentity(pid('com.sigil.file-watcher'), 'file-watcher'),
        });

        const pipeline: PersistedPipeline = {
            id: 'pipeline-legacy-contracts',
            workflowId: WorkflowIdSchema.parse('workflow-legacy-contracts'),
            schemaVersion: 1,
            nodes: [
                {
                    id: PipelineNodeIdSchema.parse('watcher'),
                    type: 'file-watcher',
                    config: FileWatcherDescriptor.defaultConfig,
                },
                {
                    id: PipelineNodeIdSchema.parse('log'),
                    type: 'log',
                    config: { message: 'migrated' },
                },
            ],
            edges: [
                {
                    id: PipelineEdgeIdSchema.parse('watcher-log'),
                    source: PipelineNodeIdSchema.parse('watcher'),
                    target: PipelineNodeIdSchema.parse('log'),
                    sourcePort: NodeOutputPortIdSchema.parse('Output'),
                },
            ],
        };

        const migrated = migrateWorkflowContracts(pipeline, registry);

        expect(migrated.value.nodes[0]).toMatchObject({
            id: 'watcher',
            type: 'file-watcher',
            pluginId: 'com.sigil.file-watcher',
        });
        expect(migrated.value.edges[0]?.sourcePort).toBe('out');
        expect(migrated.report).toEqual({
            changed: true,
            migrations: [
                expect.objectContaining({
                    kind: 'node-identity',
                    nodeId: 'watcher',
                    from: { namespace: 'builtin', type: 'file-watcher' },
                    to: {
                        namespace: 'plugin',
                        pluginId: 'com.sigil.file-watcher',
                        type: 'file-watcher',
                    },
                }),
                expect.objectContaining({
                    kind: 'port-alias',
                    nodeId: 'watcher',
                    edgeId: 'watcher-log',
                    fromPort: 'Output',
                    toPort: 'out',
                }),
            ],
        });

        const repeated = migrateWorkflowContracts(migrated.value, registry);
        expect(repeated.value).toEqual(migrated.value);
        expect(repeated.report).toEqual({ changed: false, migrations: [] });
    });
});
