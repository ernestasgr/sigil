import type { CompiledPipeline } from '@sigil/schema';
import type { NodeType, PipelineNode } from '@sigil/schema/nodes';
import type { Connection, Edge, EdgeChange, NodeChange, XYPosition } from '@xyflow/react';
import { create } from 'zustand';

import type { CompileResult, PipelineMeta } from './compile.js';
import { compileGraph } from './compile.js';
import { defaultNodeSpec, type NodeSpec } from './node-registry.js';
import {
    applyWorkflowDraftCommand,
    canLeaveWorkflowDraft,
    canRedoWorkflowDraft,
    canUndoWorkflowDraft,
    createWorkflowDraft,
    isWorkflowDraftDirty,
    markWorkflowDraftSaved,
    redoWorkflowDraft,
    undoWorkflowDraft,
    WORKFLOW_DRAFT_NODE_TYPE,
    type WorkflowDraft,
    type WorkflowDraftCommand,
    type WorkflowDraftNode,
    type WorkflowDraftSnapshot,
} from './workflow-draft.js';

export type BuilderRFNode = WorkflowDraftNode;
export const BUILDER_NODE_TYPE = WORKFLOW_DRAFT_NODE_TYPE;

export interface BuilderState {
    readonly draft: WorkflowDraft;
    readonly nodes: readonly BuilderRFNode[];
    readonly edges: readonly Edge[];
    readonly selectedNodeId: string | null;
    readonly meta: PipelineMeta;
    readonly pipelineName: string;
    readonly revision: number;
    readonly dirty: boolean;
    readonly isDirty: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly addNode: (type: NodeType, position: XYPosition) => string;
    readonly updateSpec: (nodeId: string, spec: NodeSpec) => void;
    readonly removeNode: (nodeId: string) => void;
    readonly connect: (connection: Connection) => void;
    readonly removeEdge: (edgeId: string) => void;
    readonly selectNode: (nodeId: string | null) => void;
    readonly onNodesChange: (changes: readonly NodeChange<BuilderRFNode>[]) => void;
    readonly onEdgesChange: (changes: readonly EdgeChange[]) => void;
    readonly undo: () => void;
    readonly redo: () => void;
    readonly markSaved: () => void;
    readonly canLeave: () => boolean;
    readonly compile: () => CompileResult;
    readonly getPositions: () => Readonly<
        Record<string, { readonly x: number; readonly y: number }>
    >;
    readonly clear: () => void;
    readonly loadPipeline: (
        pipeline: CompiledPipeline,
        name: string,
        positions?: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
    ) => void;
    readonly setPipelineName: (name: string) => void;
}

interface DraftProjection {
    readonly draft: WorkflowDraft;
    readonly nodes: readonly BuilderRFNode[];
    readonly edges: readonly Edge[];
    readonly meta: PipelineMeta;
    readonly pipelineName: string;
    readonly revision: number;
    readonly dirty: boolean;
    readonly isDirty: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

function freshMeta(): PipelineMeta {
    return { id: crypto.randomUUID(), workflowId: crypto.randomUUID() };
}

function emptySnapshot(): WorkflowDraftSnapshot {
    return { nodes: [], edges: [], meta: { ...freshMeta(), name: '' }, pipelineName: '' };
}

function projectDraft(draft: WorkflowDraft): DraftProjection {
    const dirty = isWorkflowDraftDirty(draft);
    return {
        draft,
        nodes: draft.current.nodes,
        edges: draft.current.edges,
        meta: draft.current.meta,
        pipelineName: draft.current.pipelineName,
        revision: draft.revision,
        dirty,
        isDirty: dirty,
        canUndo: canUndoWorkflowDraft(draft),
        canRedo: canRedoWorkflowDraft(draft),
    };
}

function selectedNodeAfterChanges(
    selectedNodeId: string | null,
    changes: readonly NodeChange<BuilderRFNode>[],
): string | null {
    let nextSelectedNodeId = selectedNodeId;
    for (const change of changes) {
        if (change.type === 'select') {
            if (change.selected) nextSelectedNodeId = change.id;
            else if (nextSelectedNodeId === change.id) nextSelectedNodeId = null;
        }
        if (change.type === 'remove' && nextSelectedNodeId === change.id) {
            nextSelectedNodeId = null;
        }
    }
    return nextSelectedNodeId;
}

function reconcileSelectedNode(
    selectedNodeId: string | null,
    nodes: readonly BuilderRFNode[],
): string | null {
    return selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId)
        ? selectedNodeId
        : null;
}

function pipelineSnapshot(
    pipeline: CompiledPipeline,
    name: string,
    positions?: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
): WorkflowDraftSnapshot {
    const nodes: BuilderRFNode[] = pipeline.nodes.map(
        (pipelineNode: PipelineNode): BuilderRFNode => ({
            id: pipelineNode.id,
            type: BUILDER_NODE_TYPE,
            position: positions?.[pipelineNode.id] ?? { x: 0, y: 0 },
            data: {
                type: pipelineNode.type,
                config: structuredClone(pipelineNode.config),
                ...('pluginId' in pipelineNode ? { pluginId: pipelineNode.pluginId } : {}),
            } as NodeSpec,
        }),
    );
    const edges: Edge[] = pipeline.edges.map((pipelineEdge) => ({
        id: pipelineEdge.id,
        source: pipelineEdge.source,
        target: pipelineEdge.target,
        sourceHandle: pipelineEdge.sourcePort,
        targetHandle: undefined,
    }));
    const meta: PipelineMeta = {
        id: pipeline.id,
        workflowId: pipeline.workflowId,
        name,
    };
    return { nodes, edges, meta, pipelineName: name };
}

export const useBuilderStore = create<BuilderState>((set, get) => {
    const initialDraft = createWorkflowDraft(emptySnapshot());

    function applyCommand(command: WorkflowDraftCommand): void {
        set((state) => projectDraft(applyWorkflowDraftCommand(state.draft, command)));
    }

    return {
        ...projectDraft(initialDraft),
        selectedNodeId: null,

        addNode: (type, position) => {
            const id = crypto.randomUUID();
            const node: BuilderRFNode = {
                id,
                type: BUILDER_NODE_TYPE,
                position,
                data: defaultNodeSpec(type),
            };
            set((state) => ({
                ...projectDraft(
                    applyWorkflowDraftCommand(state.draft, {
                        kind: 'add-node',
                        node,
                    }),
                ),
                selectedNodeId: id,
            }));
            return id;
        },

        updateSpec: (nodeId, spec) => {
            applyCommand({ kind: 'update-node-spec', nodeId, spec });
        },

        removeNode: (nodeId) => {
            set((state) => ({
                ...projectDraft(
                    applyWorkflowDraftCommand(state.draft, { kind: 'remove-node', nodeId }),
                ),
                selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
            }));
        },

        connect: (connection) => {
            applyCommand({ kind: 'connect', connection });
        },

        removeEdge: (edgeId) => {
            applyCommand({ kind: 'remove-edge', edgeId });
        },

        selectNode: (nodeId) => {
            set({ selectedNodeId: nodeId });
        },

        onNodesChange: (changes) => {
            set((state) => {
                const nextDraft = applyWorkflowDraftCommand(state.draft, {
                    kind: 'nodes-change',
                    changes,
                });
                const nextSelectedNodeId = reconcileSelectedNode(
                    selectedNodeAfterChanges(state.selectedNodeId, changes),
                    nextDraft.current.nodes,
                );
                return { ...projectDraft(nextDraft), selectedNodeId: nextSelectedNodeId };
            });
        },

        onEdgesChange: (changes) => {
            applyCommand({ kind: 'edges-change', changes });
        },

        undo: () => {
            set((state) => {
                const draft = undoWorkflowDraft(state.draft);
                return {
                    ...projectDraft(draft),
                    selectedNodeId: reconcileSelectedNode(
                        state.selectedNodeId,
                        draft.current.nodes,
                    ),
                };
            });
        },

        redo: () => {
            set((state) => {
                const draft = redoWorkflowDraft(state.draft);
                return {
                    ...projectDraft(draft),
                    selectedNodeId: reconcileSelectedNode(
                        state.selectedNodeId,
                        draft.current.nodes,
                    ),
                };
            });
        },

        markSaved: () => {
            set((state) => projectDraft(markWorkflowDraftSaved(state.draft)));
        },

        canLeave: () => canLeaveWorkflowDraft(get().draft),

        compile: () => {
            const { nodes, edges, meta } = get();
            return compileGraph(nodes, edges, meta);
        },

        getPositions: () => {
            const { nodes } = get();
            const positions: Record<string, { readonly x: number; readonly y: number }> = {};
            for (const node of nodes) {
                positions[node.id] = { x: node.position.x, y: node.position.y };
            }
            return positions;
        },

        clear: () => {
            set({ ...projectDraft(createWorkflowDraft(emptySnapshot())), selectedNodeId: null });
        },

        loadPipeline: (pipeline, name, positions) => {
            set({
                ...projectDraft(createWorkflowDraft(pipelineSnapshot(pipeline, name, positions))),
                selectedNodeId: null,
            });
        },

        setPipelineName: (name) => {
            applyCommand({ kind: 'set-pipeline-name', name });
        },
    };
});
