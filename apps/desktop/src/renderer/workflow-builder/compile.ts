import { type CompiledPipeline, parsePipeline } from '@sigil/schema';
import { isPluginNode, type PipelineNode } from '@sigil/schema/nodes';
import {
    type ExecutableWorkflow,
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';

import {
    DEFAULT_NODE_CATALOG,
    type NodeCatalog,
    pipelineNodeToSpec,
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

function droppedEdgeDiagnostic(edge: VisualEdge): TopologyDiagnostic {
    return {
        severity: 'warning',
        code: 'invalid_edge',
        target: { kind: 'edge', edgeId: edge.id },
        edgeId: edge.id,
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

        const validation = entry.validateConfig?.(node.config);
        if (validation && !validation.ok) {
            diagnostics.push({
                severity: 'error',
                code: 'invalid_plugin_config',
                target: { kind: 'node', nodeId: node.id },
                nodeId: node.id,
                fieldPath: 'config',
                message:
                    `Plugin Node "${node.type}" from "${spec.pluginId}" has invalid configuration: ` +
                    `${validation.error}`,
                repairHint:
                    'Restore the plugin configuration to the version supported by its adapter.',
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
        isTrigger:
            options?.isTrigger ??
            ((node) =>
                resolveNodeCatalogEntry(pipelineNodeToSpec(node), catalog).isTrigger === true),
        outputPortsForNode:
            options?.outputPortsForNode ??
            ((node) => resolveNodeCatalogEntry(pipelineNodeToSpec(node), catalog).outputPorts),
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
        const diagnostics = [structuralDiagnostic(parsed.error), ...droppedEdgeDiagnostics];
        return { ok: false, error: formatTopologyDiagnostics(diagnostics), diagnostics };
    }

    const catalog = topologyOptions?.nodeCatalog ?? DEFAULT_NODE_CATALOG;
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
