import type { CompiledPipeline } from '@sigil/schema';
import type { NodeType, PipelineNode } from '@sigil/schema/nodes';
import type { Connection, Edge, EdgeChange, NodeChange, XYPosition } from '@xyflow/react';
import { create } from 'zustand';

import type { CompileResult, PipelineMeta } from './compile.js';
import { compileGraph } from './compile.js';
import { nextPaletteNodePosition, resolveWorkflowPositions } from './layout.js';
import {
    DEFAULT_NODE_CATALOG,
    defaultNodeSpec,
    defaultNodeSpecForCatalogEntry,
    type NodeCatalog,
    type NodeCatalogEntry,
    type NodeSpec,
    nodeSpecData,
    pipelineNodeToSpec,
} from './node-catalog.js';
import {
    applyWorkflowDraftCommand,
    beginWorkflowDraftSave,
    canLeaveWorkflowDraft,
    canRedoWorkflowDraft,
    canUndoWorkflowDraft,
    completeWorkflowDraftSave,
    createWorkflowDraft,
    createWorkflowDraftCommandDiagnostic,
    isWorkflowDraftDirty,
    isWorkflowDraftSavePending,
    markWorkflowDraftSaved,
    recordWorkflowDraftSaveFailure,
    recordWorkflowDraftValidation,
    redoWorkflowDraft,
    rejectWorkflowDraftSave,
    undoWorkflowDraft,
    WORKFLOW_DRAFT_NODE_TYPE,
    type WorkflowDraft,
    type WorkflowDraftCommand,
    type WorkflowDraftNode,
    type WorkflowDraftSaveCommand,
    type WorkflowDraftSaveResult,
    type WorkflowDraftSaveState,
    type WorkflowDraftSnapshot,
    type WorkflowDraftValidationState,
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
    readonly saveState: WorkflowDraftSaveState;
    readonly validation: WorkflowDraftValidationState;
    readonly nodeCatalog: NodeCatalog;
    readonly addNode: (entry: NodeType | NodeCatalogEntry, position: XYPosition) => string;
    readonly addNodeFromPalette: (entry: NodeType | NodeCatalogEntry) => string;
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
    readonly save: (
        name: string,
        command: WorkflowDraftSaveCommand,
    ) => Promise<WorkflowDraftSaveResult>;
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
    readonly setNodeCatalog: (catalog: NodeCatalog) => void;
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
    readonly saveState: WorkflowDraftSaveState;
    readonly validation: WorkflowDraftValidationState;
}

function freshMeta(): PipelineMeta {
    return { id: crypto.randomUUID(), workflowId: crypto.randomUUID() };
}

function emptySnapshot(): WorkflowDraftSnapshot {
    return { nodes: [], edges: [], meta: { ...freshMeta(), name: '' }, pipelineName: '' };
}

function projectDraft(
    draft: WorkflowDraft,
    nodeCatalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): DraftProjection {
    const validatedDraft = recordWorkflowDraftValidation(
        draft,
        compileGraph(draft.current.nodes, draft.current.edges, draft.current.meta, {
            nodeCatalog,
        }),
    );
    const dirty = isWorkflowDraftDirty(validatedDraft);
    return {
        draft: validatedDraft,
        nodes: validatedDraft.current.nodes,
        edges: validatedDraft.current.edges,
        meta: validatedDraft.current.meta,
        pipelineName: validatedDraft.current.pipelineName,
        revision: validatedDraft.revision,
        dirty,
        isDirty: dirty,
        canUndo: canUndoWorkflowDraft(validatedDraft),
        canRedo: canRedoWorkflowDraft(validatedDraft),
        saveState: validatedDraft.saveState,
        validation: validatedDraft.validation,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function pendingSaveFailure(): WorkflowDraftSaveResult {
    return {
        ok: false,
        error: 'A Workflow save is already pending.',
        diagnostics: [
            createWorkflowDraftCommandDiagnostic(
                'save',
                'save_pending',
                'A Workflow save is already in progress.',
                'Wait for the pending save to finish before submitting again.',
            ),
        ],
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
    const resolvedPositions = resolveWorkflowPositions(pipeline.nodes, pipeline.edges, positions);
    const nodes: BuilderRFNode[] = pipeline.nodes.map(
        (pipelineNode: PipelineNode): BuilderRFNode => ({
            id: pipelineNode.id,
            type: BUILDER_NODE_TYPE,
            position: resolvedPositions[pipelineNode.id] ?? { x: 40, y: 40 },
            data: nodeSpecData(pipelineNodeToSpec(pipelineNode)),
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
        set((state) =>
            projectDraft(
                applyWorkflowDraftCommand(state.draft, command, state.nodeCatalog),
                state.nodeCatalog,
            ),
        );
    }

    function addNodeAtPosition(entry: NodeType | NodeCatalogEntry, position: XYPosition): string {
        const id = crypto.randomUUID();
        const node: BuilderRFNode = {
            id,
            type: BUILDER_NODE_TYPE,
            position,
            data:
                typeof entry === 'string'
                    ? defaultNodeSpec(entry)
                    : defaultNodeSpecForCatalogEntry(entry),
        };
        set((state) => ({
            ...projectDraft(
                applyWorkflowDraftCommand(
                    state.draft,
                    {
                        kind: 'add-node',
                        node,
                    },
                    state.nodeCatalog,
                ),
                state.nodeCatalog,
            ),
            selectedNodeId: id,
        }));
        return id;
    }

    return {
        ...projectDraft(initialDraft),
        selectedNodeId: null,

        addNode: addNodeAtPosition,

        addNodeFromPalette: (entry) =>
            addNodeAtPosition(entry, nextPaletteNodePosition(get().nodes)),

        updateSpec: (nodeId, spec) => {
            applyCommand({ kind: 'update-node-spec', nodeId, spec });
        },

        removeNode: (nodeId) => {
            set((state) => ({
                ...projectDraft(
                    applyWorkflowDraftCommand(
                        state.draft,
                        { kind: 'remove-node', nodeId },
                        state.nodeCatalog,
                    ),
                    state.nodeCatalog,
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
                const nextDraft = applyWorkflowDraftCommand(
                    state.draft,
                    {
                        kind: 'nodes-change',
                        changes,
                    },
                    state.nodeCatalog,
                );
                const nextSelectedNodeId = reconcileSelectedNode(
                    selectedNodeAfterChanges(state.selectedNodeId, changes),
                    nextDraft.current.nodes,
                );
                return {
                    ...projectDraft(nextDraft, state.nodeCatalog),
                    selectedNodeId: nextSelectedNodeId,
                };
            });
        },

        onEdgesChange: (changes) => {
            applyCommand({ kind: 'edges-change', changes });
        },

        undo: () => {
            set((state) => {
                const draft = undoWorkflowDraft(state.draft);
                return {
                    ...projectDraft(draft, state.nodeCatalog),
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
                    ...projectDraft(draft, state.nodeCatalog),
                    selectedNodeId: reconcileSelectedNode(
                        state.selectedNodeId,
                        draft.current.nodes,
                    ),
                };
            });
        },

        markSaved: () => {
            set((state) => projectDraft(markWorkflowDraftSaved(state.draft), state.nodeCatalog));
        },

        save: async (name, command): Promise<WorkflowDraftSaveResult> => {
            const state = get();
            if (isWorkflowDraftSavePending(state.draft)) return pendingSaveFailure();

            const result = state.compile();
            if (!result.ok) {
                set((current) => ({
                    ...projectDraft(
                        recordWorkflowDraftSaveFailure(
                            current.draft,
                            result.error,
                            result.diagnostics,
                        ),
                        current.nodeCatalog,
                    ),
                }));
                return {
                    ok: false,
                    error: result.error,
                    diagnostics: result.diagnostics,
                };
            }

            const pending = beginWorkflowDraftSave(state.draft);
            set((current) => projectDraft(pending, current.nodeCatalog));

            if (pending.saveState.status !== 'pending') {
                return pendingSaveFailure();
            }
            const attemptId = pending.saveState.attemptId;

            const request = {
                name,
                pipeline: result.value,
                positions: state.getPositions(),
                revision: pending.revision,
            };

            try {
                const outcome = await command(request);
                set((current) => ({
                    ...projectDraft(
                        outcome.ok
                            ? completeWorkflowDraftSave(current.draft, attemptId)
                            : rejectWorkflowDraftSave(
                                  current.draft,
                                  attemptId,
                                  outcome.error,
                                  outcome.diagnostics,
                              ),
                        current.nodeCatalog,
                    ),
                }));
                return outcome;
            } catch (error) {
                const message = errorMessage(error);
                const diagnostic = createWorkflowDraftCommandDiagnostic(
                    'save',
                    'save_command_failed',
                    message,
                    'Retry the save after checking the command or IPC error.',
                );
                set((current) => ({
                    ...projectDraft(
                        rejectWorkflowDraftSave(current.draft, attemptId, message, [diagnostic]),
                        current.nodeCatalog,
                    ),
                }));
                return { ok: false, error: message, diagnostics: [diagnostic] };
            }
        },

        canLeave: () => canLeaveWorkflowDraft(get().draft),

        compile: () => {
            const { nodes, edges, meta, nodeCatalog } = get();
            return compileGraph(nodes, edges, meta, { nodeCatalog });
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
            set((state) => ({
                ...projectDraft(createWorkflowDraft(emptySnapshot()), state.nodeCatalog),
                selectedNodeId: null,
            }));
        },

        loadPipeline: (pipeline, name, positions) => {
            set((state) => ({
                ...projectDraft(
                    createWorkflowDraft(pipelineSnapshot(pipeline, name, positions)),
                    state.nodeCatalog,
                ),
                selectedNodeId: null,
            }));
        },

        setPipelineName: (name) => {
            applyCommand({ kind: 'set-pipeline-name', name });
        },

        nodeCatalog: DEFAULT_NODE_CATALOG,

        setNodeCatalog: (nodeCatalog) => {
            set((state) => ({
                ...projectDraft(state.draft, nodeCatalog),
                nodeCatalog,
            }));
        },
    };
});
