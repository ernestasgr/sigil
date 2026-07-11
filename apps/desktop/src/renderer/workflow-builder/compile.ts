import { type CompiledPipeline, parsePipeline } from '@sigil/schema';
import {
    type ExecutableWorkflow,
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
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
        message: error,
    };
}

export function compileGraph(
    nodes: readonly VisualNode[],
    edges: readonly VisualEdge[],
    meta: PipelineMeta,
): CompileResult {
    const pipeline = {
        id: meta.id,
        workflowId: meta.workflowId,
        schemaVersion: 1,
        nodes: nodes.map((node) => ({
            id: node.id,
            type: node.data.type,
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
        const diagnostics = [structuralDiagnostic(parsed.error)];
        return { ok: false, error: parsed.error, diagnostics };
    }

    const topology = validateWorkflowTopology(parsed.value);
    if (!topology.ok) {
        return {
            ok: false,
            error: formatTopologyDiagnostics(topology.diagnostics),
            diagnostics: topology.diagnostics,
        };
    }

    return {
        ok: true,
        value: topology.value.pipeline,
        executable: topology.value,
    };
}
