import { parsePipeline, type CompiledPipeline } from '@sigil/schema';

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
    | { readonly ok: true; readonly value: CompiledPipeline }
    | { readonly ok: false; readonly error: string };

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
    return parsePipeline(pipeline);
}
