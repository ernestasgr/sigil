import { type CompiledPipeline, parsePipeline } from '@sigil/schema';
import {
    type ExecutableWorkflow,
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';

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

export function compileGraph(
    nodes: readonly VisualNode[],
    edges: readonly VisualEdge[],
    meta: PipelineMeta,
    topologyOptions?: WorkflowTopologyOptions,
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

    const topology = validateWorkflowTopology(parsed.value, topologyOptions);
    if (!topology.ok) {
        const diagnostics = [...topology.diagnostics, ...droppedEdgeDiagnostics];
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
        diagnostics: droppedEdgeDiagnostics,
    };
}
