import { outputPortsForNode } from '@sigil/schema/nodes';
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

import type { PipelineMeta } from './compile.js';
import type { NodeSpec } from './node-registry.js';

export type WorkflowDraftNode = Node<NodeSpec, 'sigil'>;
export const WORKFLOW_DRAFT_NODE_TYPE = 'sigil' as const;

export interface WorkflowDraftSnapshot {
    readonly nodes: readonly WorkflowDraftNode[];
    readonly edges: readonly Edge[];
    readonly meta: PipelineMeta;
    readonly pipelineName: string;
}

export interface WorkflowDraft {
    readonly current: WorkflowDraftSnapshot;
    readonly baseline: WorkflowDraftSnapshot;
    readonly revision: number;
    readonly undoStack: readonly WorkflowDraftSnapshot[];
    readonly redoStack: readonly WorkflowDraftSnapshot[];
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

function snapshotKey(snapshot: WorkflowDraftSnapshot): string {
    return JSON.stringify(stableValue(snapshot));
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
                node.id === command.nodeId
                    ? { ...node, data: structuredClone(command.spec) }
                    : node,
            );
            const validPorts = new Set(outputPortsForNode({ id: command.nodeId, ...command.spec }));
            const edges = snapshot.edges.filter(
                (edge) =>
                    edge.source !== command.nodeId ||
                    (edge.sourceHandle != null && validPorts.has(edge.sourceHandle)),
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
            const contentChanges = command.changes.filter(
                (change) => change.type !== 'select' && change.type !== 'dimensions',
            );
            if (emptyChangeList(contentChanges)) return snapshot;

            const nodes = applyNodeChanges([...contentChanges], [...snapshot.nodes]);
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
            const contentChanges = command.changes.filter((change) => change.type !== 'select');
            if (emptyChangeList(contentChanges)) return snapshot;
            return {
                ...snapshot,
                edges: applyEdgeChanges([...contentChanges], [...snapshot.edges]),
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
            return assertNever(command);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow Draft command: ${JSON.stringify(value)}`);
}

export function createWorkflowDraft(snapshot: WorkflowDraftSnapshot): WorkflowDraft {
    const current = cloneSnapshot(snapshot);
    return {
        current,
        baseline: cloneSnapshot(current),
        revision: 0,
        undoStack: [],
        redoStack: [],
    };
}

export function replaceWorkflowDraft(snapshot: WorkflowDraftSnapshot): WorkflowDraft {
    return createWorkflowDraft(snapshot);
}

export function applyWorkflowDraftCommand(
    draft: WorkflowDraft,
    command: WorkflowDraftCommand,
): WorkflowDraft {
    const next = cloneSnapshot(applyCommand(draft.current, command));
    if (snapshotsEqual(next, draft.current)) return draft;

    return {
        current: next,
        baseline: draft.baseline,
        revision: draft.revision + 1,
        undoStack: [...draft.undoStack, cloneSnapshot(draft.current)],
        redoStack: [],
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
    };
}

export function markWorkflowDraftSaved(draft: WorkflowDraft): WorkflowDraft {
    return {
        ...draft,
        baseline: cloneSnapshot(draft.current),
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
