import { type CompiledPipeline, type PipelineParseIssue, parsePipeline } from '@sigil/schema';
import { PipelineEdgeIdSchema, PipelineNodeIdSchema } from '@sigil/schema/ids';
import { isPluginNode, type PipelineNode } from '@sigil/schema/nodes';
import {
    type ExecutableWorkflow,
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';

import {
    createNodeCatalog,
    DEFAULT_NODE_CATALOG,
    type NodeCatalog,
    resolveNodeCatalogEntry,
} from './node-catalog.js';

export interface PipelineMeta {
    readonly id: string;
    readonly workflowId: string;
    readonly name?: string;
}

export interface VisualNode {
    readonly id: string;
    readonly data: {
        readonly type: string;
        readonly config: unknown;
        readonly pluginId?: string;
    };
}

export interface VisualEdge {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly sourceHandle?: string | null | undefined;
}

export type CompileResult =
    | {
          readonly ok: true;
          readonly value: CompiledPipeline;
          readonly executable: ExecutableWorkflow;
          readonly diagnostics: readonly TopologyDiagnostic[];
      }
    | {
          readonly ok: false;
          readonly error: string;
          readonly diagnostics: readonly TopologyDiagnostic[];
      };

export type CompileOptions = WorkflowTopologyOptions & {
    readonly nodeCatalog?: NodeCatalog;
};

function structuralDiagnostic(error: string): TopologyDiagnostic {
    return {
        severity: 'error',
        code: 'invalid_pipeline',
        target: { kind: 'pipeline' },
        message: `Workflow data is invalid: ${error} Repair the affected Node or Edge before saving.`,
    };
}

function parseIssueNodeIndex(issue: PipelineParseIssue): number | null {
    if (issue.path[0] !== 'nodes') return null;
    const index = issue.path[1];
    return typeof index === 'number' ? index : null;
}

function parseIssueConfigPath(issue: PipelineParseIssue): string | null {
    if (issue.path[2] !== 'config') return null;
    const configPath = issue.path.slice(2).map(String);
    return configPath.join('.').replace(/\.(\d+)(?=\.|$)/g, '[$1]');
}

function nodeConfigurationDiagnostic(
    node: VisualNode,
    issue: PipelineParseIssue,
): TopologyDiagnostic | null {
    const fieldPath = parseIssueConfigPath(issue);
    const nodeId = PipelineNodeIdSchema.safeParse(node.id);
    if (fieldPath === null || !nodeId.success) return null;

    return {
        severity: 'error',
        code: 'invalid_pipeline',
        target: { kind: 'node', nodeId: nodeId.data },
        nodeId: nodeId.data,
        fieldPath,
        message:
            `Node "${node.id}" has invalid configuration at ${fieldPath}: ${issue.message} ` +
            'Repair the affected field before saving.',
    };
}

function structuralDiagnostics(
    error: string,
    issues: readonly PipelineParseIssue[],
    nodes: readonly VisualNode[],
): readonly TopologyDiagnostic[] {
    const nodeDiagnostics = issues.flatMap((issue) => {
        const nodeIndex = parseIssueNodeIndex(issue);
        const node = nodeIndex === null ? undefined : nodes[nodeIndex];
        if (!node || node.data.pluginId !== undefined) return [];

        const diagnostic = nodeConfigurationDiagnostic(node, issue);
        return diagnostic ? [diagnostic] : [];
    });

    return nodeDiagnostics.length > 0 ? nodeDiagnostics : [structuralDiagnostic(error)];
}

function droppedEdgeDiagnostic(edge: VisualEdge): TopologyDiagnostic {
    const edgeId = PipelineEdgeIdSchema.parse(edge.id);
    return {
        severity: 'warning',
        code: 'invalid_edge',
        target: { kind: 'edge', edgeId },
        edgeId,
        message: `Edge "${edge.id}" has no source port and was omitted from the compiled Workflow; reconnect it to a declared output port.`,
    };
}

function pluginNodeSpec(node: PipelineNode): {
    readonly type: string;
    readonly pluginId: string;
    readonly config: unknown;
} | null {
    return isPluginNode(node)
        ? { type: node.type, pluginId: node.pluginId, config: node.config }
        : null;
}

function pluginCatalogDiagnostics(
    nodes: readonly PipelineNode[],
    catalog: NodeCatalog,
): readonly TopologyDiagnostic[] {
    const diagnostics: TopologyDiagnostic[] = [];

    for (const node of nodes) {
        const spec = pluginNodeSpec(node);
        if (!spec) continue;

        const entry = resolveNodeCatalogEntry(spec, catalog);
        if (entry.authoring === 'read-only') {
            diagnostics.push({
                severity: 'warning',
                code: 'unsupported_plugin_authoring',
                target: { kind: 'node', nodeId: node.id },
                nodeId: node.id,
                message:
                    `Plugin Node "${node.type}" from "${spec.pluginId}" has no Workflow Builder ` +
                    'authoring adapter; it is read-only and will be preserved unchanged.',
                repairHint:
                    'Install or register a Plugin Node authoring adapter before editing it.',
            });
        }
    }

    return diagnostics;
}

function topologyOptionsWithCatalog(
    options: CompileOptions | undefined,
    catalog: NodeCatalog,
): WorkflowTopologyOptions {
    return {
        ...(options?.isNodeSupported ? { isNodeSupported: options.isNodeSupported } : {}),
        ...(options?.requireNodeContracts ? { requireNodeContracts: true } : {}),
        contractRegistry: options?.contractRegistry ?? catalog.contractRegistry,
    };
}

export function compileGraph(
    nodes: readonly VisualNode[],
    edges: readonly VisualEdge[],
    meta: PipelineMeta,
    topologyOptions?: CompileOptions,
): CompileResult {
    const droppedEdgeDiagnostics = edges
        .filter((edge) => edge.sourceHandle == null)
        .map(droppedEdgeDiagnostic);
    const pipeline = {
        id: meta.id,
        workflowId: meta.workflowId,
        schemaVersion: 1,
        nodes: nodes.map((node) => ({
            id: node.id,
            type: node.data.type,
            ...(node.data.pluginId != null ? { pluginId: node.data.pluginId } : {}),
            config: node.data.config,
        })),
        edges: edges
            .filter(
                (edge): edge is VisualEdge & { sourceHandle: string } => edge.sourceHandle != null,
            )
            .map((edge) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourcePort: edge.sourceHandle,
            })),
    };
    const parsed = parsePipeline(pipeline);
    if (!parsed.ok) {
        const diagnostics = [
            ...structuralDiagnostics(parsed.error, parsed.issues, nodes),
            ...droppedEdgeDiagnostics,
        ];
        return { ok: false, error: formatTopologyDiagnostics(diagnostics), diagnostics };
    }

    const catalog =
        topologyOptions?.nodeCatalog ??
        (topologyOptions?.contractRegistry
            ? createNodeCatalog([], { contractRegistry: topologyOptions.contractRegistry })
            : DEFAULT_NODE_CATALOG);
    const catalogDiagnostics = pluginCatalogDiagnostics(parsed.value.nodes, catalog);
    const topology = validateWorkflowTopology(
        parsed.value,
        topologyOptionsWithCatalog(topologyOptions, catalog),
    );
    if (!topology.ok) {
        const diagnostics = [
            ...catalogDiagnostics,
            ...topology.diagnostics,
            ...droppedEdgeDiagnostics,
        ];
        return {
            ok: false,
            error: formatTopologyDiagnostics(diagnostics),
            diagnostics,
        };
    }

    const hasCatalogErrors = catalogDiagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
    );
    if (hasCatalogErrors) {
        const diagnostics = [...catalogDiagnostics, ...droppedEdgeDiagnostics];
        return {
            ok: false,
            error: formatTopologyDiagnostics(diagnostics),
            diagnostics,
        };
    }

    return {
        ok: true,
        value: topology.value.pipeline,
        executable: topology.value,
        diagnostics: [...catalogDiagnostics, ...droppedEdgeDiagnostics],
    };
}
