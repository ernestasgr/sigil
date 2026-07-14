import type { CompiledPipeline } from '@sigil/schema';
import type { TopologyDiagnostic } from '@sigil/schema/topology';
import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
} from '@xyflow/react';

import type { WorkflowWriteDiagnostic } from '../../shared/ipc-channels.js';
import { assertNever } from './assert-never.js';
import type { PipelineMeta } from './compile.js';
import {
    type BuilderNodeSpec,
    type NodeSpec,
    nodeOutputPorts,
    nodeSpecData,
} from './node-catalog.js';

export type WorkflowDraftNode = Node<BuilderNodeSpec, 'sigil'>;
export const WORKFLOW_DRAFT_NODE_TYPE = 'sigil' as const;

export interface WorkflowDraftSnapshot {
    readonly nodes: readonly WorkflowDraftNode[];
    readonly edges: readonly Edge[];
    readonly meta: PipelineMeta;
    readonly pipelineName: string;
}

export interface WorkflowDraftSaveRequest {
    readonly name: string;
    readonly pipeline: CompiledPipeline;
    readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
    readonly revision: number;
}

export interface WorkflowDraftCommandDiagnostic {
    readonly kind: 'command';
    readonly operation: 'save' | 'export';
    readonly code: string;
    readonly target: { readonly kind: 'pipeline' };
    readonly message: string;
    readonly repairHint?: string;
}

export type WorkflowDraftDiagnostic = WorkflowWriteDiagnostic | WorkflowDraftCommandDiagnostic;

export type WorkflowDraftSaveResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly error: string;
          readonly diagnostics: readonly WorkflowDraftDiagnostic[];
      };

export type WorkflowDraftSaveCommand = (
    request: WorkflowDraftSaveRequest,
) => Promise<WorkflowDraftSaveResult>;

export type WorkflowDraftSaveAttemptId = string & {
    readonly __brand: 'WorkflowDraftSaveAttemptId';
};

export type WorkflowDraftSaveState =
    | { readonly status: 'idle' }
    | {
          readonly status: 'pending';
          readonly revision: number;
          readonly attemptId: WorkflowDraftSaveAttemptId;
      }
    | {
          readonly status: 'success';
          readonly revision: number;
          readonly attemptId: WorkflowDraftSaveAttemptId;
      }
    | {
          readonly status: 'failure';
          readonly revision: number;
          readonly attemptId: WorkflowDraftSaveAttemptId;
          readonly error: string;
          readonly diagnostics: readonly WorkflowDraftDiagnostic[];
      };

export type WorkflowDraftValidationState =
    | {
          readonly status: 'unvalidated';
          readonly diagnostics: readonly TopologyDiagnostic[];
      }
    | {
          readonly status: 'valid';
          readonly diagnostics: readonly TopologyDiagnostic[];
      }
    | {
          readonly status: 'invalid';
          readonly diagnostics: readonly TopologyDiagnostic[];
      };

export interface WorkflowDraft {
    readonly current: WorkflowDraftSnapshot;
    readonly baseline: WorkflowDraftSnapshot;
    readonly revision: number;
    readonly undoStack: readonly WorkflowDraftSnapshot[];
    readonly redoStack: readonly WorkflowDraftSnapshot[];
    readonly saveState: WorkflowDraftSaveState;
    readonly validation: WorkflowDraftValidationState;
}

export type WorkflowDraftCommand =
    | {
          readonly kind: 'add-node';
          readonly node: WorkflowDraftNode;
      }
    | {
          readonly kind: 'update-node-spec';
          readonly nodeId: string;
          readonly spec: NodeSpec;
      }
    | {
          readonly kind: 'remove-node';
          readonly nodeId: string;
      }
    | {
          readonly kind: 'connect';
          readonly connection: Connection;
      }
    | {
          readonly kind: 'remove-edge';
          readonly edgeId: string;
      }
    | {
          readonly kind: 'nodes-change';
          readonly changes: readonly NodeChange<WorkflowDraftNode>[];
      }
    | {
          readonly kind: 'edges-change';
          readonly changes: readonly EdgeChange[];
      }
    | {
          readonly kind: 'set-pipeline-name';
          readonly name: string;
      };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isRecord(value)) return value;

    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, stableValue(entry)]),
    );
}

const REACT_FLOW_RUNTIME_NODE_FIELDS = new Set([
    'selected',
    'dragging',
    'measured',
    'resizing',
    'width',
    'height',
]);

function snapshotForComparison(snapshot: WorkflowDraftSnapshot): unknown {
    return {
        ...snapshot,
        nodes: snapshot.nodes.map((node) =>
            Object.fromEntries(
                Object.entries(node).filter(([key]) => !REACT_FLOW_RUNTIME_NODE_FIELDS.has(key)),
            ),
        ),
        edges: snapshot.edges.map((edge) =>
            Object.fromEntries(Object.entries(edge).filter(([key]) => key !== 'selected')),
        ),
    };
}

function snapshotKey(snapshot: WorkflowDraftSnapshot): string {
    return JSON.stringify(stableValue(snapshotForComparison(snapshot)));
}

function snapshotsEqual(left: WorkflowDraftSnapshot, right: WorkflowDraftSnapshot): boolean {
    return snapshotKey(left) === snapshotKey(right);
}

function cloneSnapshot(snapshot: WorkflowDraftSnapshot): WorkflowDraftSnapshot {
    return structuredClone({
        nodes: [...snapshot.nodes],
        edges: [...snapshot.edges],
        meta: { ...snapshot.meta, name: snapshot.pipelineName },
        pipelineName: snapshot.pipelineName,
    });
}

function createWorkflowDraftSaveAttemptId(): WorkflowDraftSaveAttemptId {
    return crypto.randomUUID() as WorkflowDraftSaveAttemptId;
}

function saveStateAfterEdit(saveState: WorkflowDraftSaveState): WorkflowDraftSaveState {
    return saveState.status === 'pending' ? saveState : { status: 'idle' };
}

function validationAfterEdit(): WorkflowDraftValidationState {
    return { status: 'unvalidated', diagnostics: [] };
}

function emptyChangeList<T>(changes: readonly T[]): boolean {
    return changes.length === 0;
}

function applyCommand(
    snapshot: WorkflowDraftSnapshot,
    command: WorkflowDraftCommand,
): WorkflowDraftSnapshot {
    switch (command.kind) {
        case 'add-node': {
            if (snapshot.nodes.some((node) => node.id === command.node.id)) return snapshot;
            return {
                ...snapshot,
                nodes: [...snapshot.nodes, structuredClone(command.node)],
            };
        }
        case 'update-node-spec': {
            if (!snapshot.nodes.some((node) => node.id === command.nodeId)) return snapshot;

            const nodes = snapshot.nodes.map((node) =>
                node.id === command.nodeId ? { ...node, data: nodeSpecData(command.spec) } : node,
            );
            const outputPorts = nodeOutputPorts(command.spec);
            const edges =
                outputPorts === 'dynamic'
                    ? snapshot.edges
                    : snapshot.edges.filter(
                          (edge) =>
                              edge.source !== command.nodeId ||
                              (edge.sourceHandle != null &&
                                  outputPorts.includes(edge.sourceHandle)),
                      );
            return { ...snapshot, nodes, edges };
        }
        case 'remove-node': {
            if (!snapshot.nodes.some((node) => node.id === command.nodeId)) return snapshot;
            return {
                ...snapshot,
                nodes: snapshot.nodes.filter((node) => node.id !== command.nodeId),
                edges: snapshot.edges.filter(
                    (edge) => edge.source !== command.nodeId && edge.target !== command.nodeId,
                ),
            };
        }
        case 'connect': {
            const { source, target, sourceHandle } = command.connection;
            if (!source || !target || !sourceHandle) return snapshot;
            return {
                ...snapshot,
                edges: addEdge(command.connection, [...snapshot.edges]),
            };
        }
        case 'remove-edge': {
            if (!snapshot.edges.some((edge) => edge.id === command.edgeId)) return snapshot;
            return {
                ...snapshot,
                edges: snapshot.edges.filter((edge) => edge.id !== command.edgeId),
            };
        }
        case 'nodes-change': {
            if (emptyChangeList(command.changes)) return snapshot;

            const nodes = applyNodeChanges([...command.changes], [...snapshot.nodes]);
            const removedIds = new Set(
                command.changes
                    .filter(
                        (change): change is NodeChange<WorkflowDraftNode> & { type: 'remove' } =>
                            change.type === 'remove',
                    )
                    .map((change) => change.id),
            );
            if (removedIds.size === 0) return { ...snapshot, nodes };

            return {
                ...snapshot,
                nodes,
                edges: snapshot.edges.filter(
                    (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target),
                ),
            };
        }
        case 'edges-change': {
            if (emptyChangeList(command.changes)) return snapshot;
            return {
                ...snapshot,
                edges: applyEdgeChanges([...command.changes], [...snapshot.edges]),
            };
        }
        case 'set-pipeline-name':
            if (snapshot.pipelineName === command.name && snapshot.meta.name === command.name) {
                return snapshot;
            }
            return {
                ...snapshot,
                meta: { ...snapshot.meta, name: command.name },
                pipelineName: command.name,
            };
        default:
            return assertNever(
                command,
                `Unhandled Workflow Draft command: ${JSON.stringify(command)}`,
            );
    }
}

export function createWorkflowDraft(snapshot: WorkflowDraftSnapshot): WorkflowDraft {
    const current = cloneSnapshot(snapshot);
    return {
        current,
        baseline: cloneSnapshot(current),
        revision: 0,
        undoStack: [],
        redoStack: [],
        saveState: { status: 'idle' },
        validation: validationAfterEdit(),
    };
}

export function replaceWorkflowDraft(snapshot: WorkflowDraftSnapshot): WorkflowDraft {
    return createWorkflowDraft(snapshot);
}

export function applyWorkflowDraftCommand(
    draft: WorkflowDraft,
    command: WorkflowDraftCommand,
): WorkflowDraft {
    const applied = applyCommand(draft.current, command);
    if (applied === draft.current) return draft;

    const next = cloneSnapshot(applied);
    if (snapshotsEqual(next, draft.current)) {
        return { ...draft, current: next };
    }

    return {
        current: next,
        baseline: draft.baseline,
        revision: draft.revision + 1,
        undoStack: [...draft.undoStack, cloneSnapshot(draft.current)],
        redoStack: [],
        saveState: saveStateAfterEdit(draft.saveState),
        validation: validationAfterEdit(),
    };
}

export function undoWorkflowDraft(draft: WorkflowDraft): WorkflowDraft {
    const previous = draft.undoStack[draft.undoStack.length - 1];
    if (!previous) return draft;

    return {
        current: cloneSnapshot(previous),
        baseline: draft.baseline,
        revision: draft.revision + 1,
        undoStack: draft.undoStack.slice(0, -1),
        redoStack: [...draft.redoStack, cloneSnapshot(draft.current)],
        saveState: saveStateAfterEdit(draft.saveState),
        validation: validationAfterEdit(),
    };
}

export function redoWorkflowDraft(draft: WorkflowDraft): WorkflowDraft {
    const next = draft.redoStack[draft.redoStack.length - 1];
    if (!next) return draft;

    return {
        current: cloneSnapshot(next),
        baseline: draft.baseline,
        revision: draft.revision + 1,
        undoStack: [...draft.undoStack, cloneSnapshot(draft.current)],
        redoStack: draft.redoStack.slice(0, -1),
        saveState: saveStateAfterEdit(draft.saveState),
        validation: validationAfterEdit(),
    };
}

export function markWorkflowDraftSaved(draft: WorkflowDraft): WorkflowDraft {
    return {
        ...draft,
        baseline: cloneSnapshot(draft.current),
        saveState: {
            status: 'success',
            revision: draft.revision,
            attemptId: createWorkflowDraftSaveAttemptId(),
        },
    };
}

export function recordWorkflowDraftValidation(
    draft: WorkflowDraft,
    result: { readonly ok: boolean; readonly diagnostics: readonly TopologyDiagnostic[] },
): WorkflowDraft {
    return {
        ...draft,
        validation: {
            status: result.ok ? 'valid' : 'invalid',
            diagnostics: [...result.diagnostics],
        },
    };
}

export function isWorkflowDraftSavePending(draft: WorkflowDraft): boolean {
    return draft.saveState.status === 'pending';
}

export function beginWorkflowDraftSave(draft: WorkflowDraft): WorkflowDraft {
    if (isWorkflowDraftSavePending(draft)) return draft;
    return {
        ...draft,
        saveState: {
            status: 'pending',
            revision: draft.revision,
            attemptId: createWorkflowDraftSaveAttemptId(),
        },
    };
}

export function completeWorkflowDraftSave(
    draft: WorkflowDraft,
    attemptId: WorkflowDraftSaveAttemptId,
): WorkflowDraft {
    if (draft.saveState.status !== 'pending' || draft.saveState.attemptId !== attemptId) {
        return draft;
    }

    const revision = draft.saveState.revision;
    return {
        ...draft,
        baseline: draft.revision === revision ? cloneSnapshot(draft.current) : draft.baseline,
        saveState: { status: 'success', revision, attemptId },
    };
}

export function rejectWorkflowDraftSave(
    draft: WorkflowDraft,
    attemptId: WorkflowDraftSaveAttemptId,
    error: string,
    diagnostics: readonly WorkflowDraftDiagnostic[],
): WorkflowDraft {
    if (draft.saveState.status !== 'pending' || draft.saveState.attemptId !== attemptId) {
        return draft;
    }

    return {
        ...draft,
        saveState: {
            status: 'failure',
            revision: draft.saveState.revision,
            attemptId,
            error,
            diagnostics: [...diagnostics],
        },
    };
}

export function recordWorkflowDraftSaveFailure(
    draft: WorkflowDraft,
    error: string,
    diagnostics: readonly WorkflowDraftDiagnostic[],
): WorkflowDraft {
    return {
        ...draft,
        saveState: {
            status: 'failure',
            revision: draft.revision,
            attemptId: createWorkflowDraftSaveAttemptId(),
            error,
            diagnostics: [...diagnostics],
        },
    };
}

export function createWorkflowDraftCommandDiagnostic(
    operation: WorkflowDraftCommandDiagnostic['operation'],
    code: string,
    message: string,
    repairHint?: string,
): WorkflowDraftCommandDiagnostic {
    return {
        kind: 'command',
        operation,
        code,
        target: { kind: 'pipeline' },
        message,
        ...(repairHint ? { repairHint } : {}),
    };
}

export function isWorkflowDraftDirty(draft: WorkflowDraft): boolean {
    return !snapshotsEqual(draft.current, draft.baseline);
}

export function canUndoWorkflowDraft(draft: WorkflowDraft): boolean {
    return draft.undoStack.length > 0;
}

export function canRedoWorkflowDraft(draft: WorkflowDraft): boolean {
    return draft.redoStack.length > 0;
}

export function canLeaveWorkflowDraft(draft: WorkflowDraft): boolean {
    return !isWorkflowDraftDirty(draft);
}
