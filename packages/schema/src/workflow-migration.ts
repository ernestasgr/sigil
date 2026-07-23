import { z } from 'zod';

import {
    BUILTIN_NODE_CONTRACT_REGISTRY,
    type NodeContractRegistry,
    type NodeIdentity,
    type NodeOutputPort,
    resolveNodeContract,
    resolveOutputPortId,
} from './node-contract.js';
import { isPluginNode, type PipelineNode } from './nodes/index.js';
import type { PersistedPipeline } from './pipeline.js';

export const WorkflowMigrationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('node-identity'),
            nodeId: z.string().min(1),
            from: z.object({ namespace: z.literal('builtin'), type: z.string().min(1) }),
            to: z.object({
                namespace: z.literal('plugin'),
                pluginId: z.string().min(1),
                type: z.string().min(1),
            }),
            reason: z.string().min(1),
        })
        .readonly(),
    z
        .object({
            kind: z.literal('port-alias'),
            nodeId: z.string().min(1),
            edgeId: z.string().min(1),
            fromPort: z.string().min(1),
            toPort: z.string().min(1),
            reason: z.string().min(1),
        })
        .readonly(),
]);
export type WorkflowMigration = z.infer<typeof WorkflowMigrationSchema>;

export const WorkflowMigrationReportSchema = z
    .object({
        changed: z.boolean(),
        migrations: z.array(WorkflowMigrationSchema).readonly(),
    })
    .readonly();
export type WorkflowMigrationReport = z.infer<typeof WorkflowMigrationReportSchema>;

export interface LegacyNodeIdentityMigration {
    readonly from: Extract<NodeIdentity, { readonly namespace: 'builtin' }>;
    readonly to: Extract<NodeIdentity, { readonly namespace: 'plugin' }>;
    readonly reason: string;
}

export const LEGACY_BUNDLED_NODE_IDENTITY_MIGRATIONS: readonly LegacyNodeIdentityMigration[] = [
    {
        from: { namespace: 'builtin', type: 'file-watcher' },
        to: { namespace: 'plugin', pluginId: 'com.sigil.file-watcher', type: 'file-watcher' },
        reason: 'Bundled File Watcher Nodes now execute through their namespaced Plugin identity.',
    },
    {
        from: { namespace: 'builtin', type: 'file-manager' },
        to: { namespace: 'plugin', pluginId: 'com.sigil.file-manager', type: 'file-manager' },
        reason: 'Bundled File Manager Nodes now execute through their namespaced Plugin identity.',
    },
];

function legacyMigrationForNode(node: PipelineNode): LegacyNodeIdentityMigration | undefined {
    if (isPluginNode(node)) return undefined;
    return LEGACY_BUNDLED_NODE_IDENTITY_MIGRATIONS.find(
        (migration) => migration.from.type === node.type,
    );
}

function migrateLegacyNode(node: PipelineNode): {
    readonly node: PipelineNode;
    readonly migration?: WorkflowMigration;
} {
    const migration = legacyMigrationForNode(node);
    if (!migration) return { node };

    return {
        node: {
            ...node,
            type: migration.to.type,
            pluginId: migration.to.pluginId,
        },
        migration: {
            kind: 'node-identity',
            nodeId: node.id,
            from: migration.from,
            to: migration.to,
            reason: migration.reason,
        },
    };
}

function concreteOutputPorts(
    node: PipelineNode,
    registry: NodeContractRegistry,
): readonly NodeOutputPort[] | undefined {
    const resolution = resolveNodeContract(node, registry);
    if (resolution.status === 'available' && resolution.outputPorts !== 'dynamic') {
        return resolution.outputPorts;
    }
    if (resolution.status === 'invalid' && resolution.outputPorts !== undefined) {
        return resolution.outputPorts === 'dynamic' ? undefined : resolution.outputPorts;
    }
    return undefined;
}

export function migrateWorkflowContracts(
    pipeline: PersistedPipeline,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): { readonly value: PersistedPipeline; readonly report: WorkflowMigrationReport } {
    const migrations: WorkflowMigration[] = [];
    const nodes = pipeline.nodes.map((node) => {
        const migrated = migrateLegacyNode(node);
        if (migrated.migration) migrations.push(migrated.migration);
        return migrated.node;
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
    const edges = pipeline.edges.map((edge) => {
        const sourceNode = nodeById.get(edge.source);
        if (!sourceNode) return edge;

        const ports = concreteOutputPorts(sourceNode, registry);
        if (!ports) return edge;

        const resolved = resolveOutputPortId(ports, edge.sourcePort);
        if (!resolved.ok || resolved.matchedBy === 'id') return edge;

        migrations.push({
            kind: 'port-alias',
            nodeId: sourceNode.id,
            edgeId: edge.id,
            fromPort: edge.sourcePort,
            toPort: resolved.portId,
            reason: 'The Node Contract declares the persisted port value as an alias.',
        });
        return { ...edge, sourcePort: resolved.portId };
    });

    const changed = migrations.length > 0;
    return {
        value: changed ? { ...pipeline, nodes, edges } : pipeline,
        report: {
            changed,
            migrations,
        },
    };
}
