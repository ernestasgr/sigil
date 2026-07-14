import type { CompiledPipeline } from '@sigil/schema';
import { isPluginNode, type NodeType, type PipelineNode } from '@sigil/schema/nodes';
import type { Connection, Edge, EdgeChange, NodeChange, XYPosition } from '@xyflow/react';
import { create } from 'zustand';

import type { CompileResult, PipelineMeta } from './compile.js';
import { compileGraph } from './compile.js';
import { nextPaletteNodePosition, resolveWorkflowPositions } from './layout.js';
import { defaultNodeSpec, type NodeSpec } from './node-registry.js';
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
    readonly addNode: (type: NodeType, position: XYPosition) => string;
    readonly addNodeFromPalette: (type: NodeType) => string;
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

function projectDraft(draft: WorkflowDraft): DraftProjection {
    const validatedDraft = recordWorkflowDraftValidation(
        draft,
        compileGraph(draft.current.nodes, draft.current.edges, draft.current.meta),
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

function assertNever(value: never): never {
    throw new Error(`Unhandled built-in Node type: ${String(value)}`);
}

function pipelineNodeToSpec(pipelineNode: PipelineNode): NodeSpec {
    if (isPluginNode(pipelineNode)) {
        return {
            type: pipelineNode.type,
            pluginId: pipelineNode.pluginId,
            config: structuredClone(pipelineNode.config),
        };
    }

    switch (pipelineNode.type) {
        case 'file-watcher':
            return { type: 'file-watcher', config: structuredClone(pipelineNode.config) };
        case 'manual-trigger':
            return { type: 'manual-trigger', config: structuredClone(pipelineNode.config) };
        case 'if-else':
            return { type: 'if-else', config: structuredClone(pipelineNode.config) };
        case 'switch':
            return { type: 'switch', config: structuredClone(pipelineNode.config) };
        case 'file-manager':
            return { type: 'file-manager', config: structuredClone(pipelineNode.config) };
        case 'notification':
            return { type: 'notification', config: structuredClone(pipelineNode.config) };
        case 'log':
            return { type: 'log', config: structuredClone(pipelineNode.config) };
        case 'delay':
            return { type: 'delay', config: structuredClone(pipelineNode.config) };
        case 'state-get':
            return { type: 'state-get', config: structuredClone(pipelineNode.config) };
        case 'state-set':
            return { type: 'state-set', config: structuredClone(pipelineNode.config) };
        default:
            return assertNever(pipelineNode);
    }
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
            data: pipelineNodeToSpec(pipelineNode),
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

    function addNodeAtPosition(type: NodeType, position: XYPosition): string {
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
    }

    return {
        ...projectDraft(initialDraft),
        selectedNodeId: null,

        addNode: addNodeAtPosition,

        addNodeFromPalette: (type) => addNodeAtPosition(type, nextPaletteNodePosition(get().nodes)),

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
                    ),
                }));
                return {
                    ok: false,
                    error: result.error,
                    diagnostics: result.diagnostics,
                };
            }

            const pending = beginWorkflowDraftSave(state.draft);
            set(() => projectDraft(pending));

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
                    ),
                }));
                return { ok: false, error: message, diagnostics: [diagnostic] };
            }
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
