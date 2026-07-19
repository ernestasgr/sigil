import { describe, expect, it } from 'vitest';

import { defaultNodeSpec } from './node-registry.js';
import {
    applyWorkflowDraftCommand,
    beginWorkflowDraftSave,
    canRedoWorkflowDraft,
    canUndoWorkflowDraft,
    completeWorkflowDraftSave,
    createWorkflowDraft,
    isWorkflowDraftDirty,
    isWorkflowDraftSavePending,
    markWorkflowDraftSaved,
    redoWorkflowDraft,
    rejectWorkflowDraftSave,
    undoWorkflowDraft,
    type WorkflowDraftDiagnostic,
    type WorkflowDraftSnapshot,
} from './workflow-draft.js';

function emptySnapshot(): WorkflowDraftSnapshot {
    return {
        nodes: [],
        edges: [],
        meta: { id: 'pipeline-1', workflowId: 'workflow-1' },
        pipelineName: '',
    };
}

function logNode(id: string) {
    return {
        id,
        type: 'sigil' as const,
        position: { x: 0, y: 0 },
        data: defaultNodeSpec('log'),
    };
}

describe('WorkflowDraft', () => {
    it('keeps a drag transient and commits one undoable revision at the end', () => {
        let draft = createWorkflowDraft({
            ...emptySnapshot(),
            nodes: [logNode('log-1')],
        });

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 40, y: 20 },
                    dragging: true,
                },
            ],
        });
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 80, y: 40 },
                    dragging: true,
                },
            ],
        });

        expect(draft.current.nodes[0]?.position).toEqual({ x: 80, y: 40 });
        expect(draft.revision).toBe(0);
        expect(draft.undoStack).toHaveLength(0);
        expect(draft.activeNodeDrag).not.toBeNull();

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 100, y: 60 },
                    dragging: false,
                },
            ],
        });

        expect(draft.current.nodes[0]?.position).toEqual({ x: 100, y: 60 });
        expect(draft.revision).toBe(1);
        expect(draft.undoStack).toHaveLength(1);
        expect(draft.activeNodeDrag).toBeNull();

        draft = undoWorkflowDraft(draft);
        expect(draft.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
        expect(draft.activeNodeDrag).toBeNull();

        draft = redoWorkflowDraft(draft);
        expect(draft.current.nodes[0]?.position).toEqual({ x: 100, y: 60 });
        expect(draft.activeNodeDrag).toBeNull();
    });

    it('cancels an active drag on undo and redo and clears it on node removal', () => {
        let draft = createWorkflowDraft({
            ...emptySnapshot(),
            nodes: [logNode('log-1')],
        });

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [{ id: 'log-1', type: 'position', position: { x: 40, y: 20 } }],
        });
        draft = undoWorkflowDraft(draft);
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 80, y: 40 },
                    dragging: true,
                },
            ],
        });

        draft = undoWorkflowDraft(draft);
        expect(draft.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
        expect(draft.activeNodeDrag).toBeNull();

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 100, y: 60 },
                    dragging: true,
                },
            ],
        });
        draft = redoWorkflowDraft(draft);
        expect(draft.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
        expect(draft.activeNodeDrag).toBeNull();

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'position',
                    position: { x: 120, y: 80 },
                    dragging: true,
                },
            ],
        });
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [{ id: 'log-1', type: 'remove' }],
        });

        expect(draft.current.nodes).toEqual([]);
        expect(draft.activeNodeDrag).toBeNull();
    });

    it('tracks a loaded baseline and makes an edit undoable and redoable', () => {
        let draft = createWorkflowDraft(emptySnapshot());

        expect(draft.revision).toBe(0);
        expect(isWorkflowDraftDirty(draft)).toBe(false);
        expect(canUndoWorkflowDraft(draft)).toBe(false);

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });

        expect(draft.revision).toBe(1);
        expect(isWorkflowDraftDirty(draft)).toBe(true);
        expect(canUndoWorkflowDraft(draft)).toBe(true);
        expect(canRedoWorkflowDraft(draft)).toBe(false);

        draft = undoWorkflowDraft(draft);

        expect(draft.current.nodes).toEqual([]);
        expect(draft.revision).toBe(2);
        expect(isWorkflowDraftDirty(draft)).toBe(false);
        expect(canRedoWorkflowDraft(draft)).toBe(true);

        draft = redoWorkflowDraft(draft);

        expect(draft.current.nodes.map((node) => node.id)).toEqual(['log-1']);
        expect(isWorkflowDraftDirty(draft)).toBe(true);
    });

    it('resets the saved baseline without discarding undo history', () => {
        let draft = createWorkflowDraft(emptySnapshot());
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });
        draft = markWorkflowDraftSaved(draft);

        expect(isWorkflowDraftDirty(draft)).toBe(false);
        expect(canUndoWorkflowDraft(draft)).toBe(true);

        draft = undoWorkflowDraft(draft);

        expect(isWorkflowDraftDirty(draft)).toBe(true);
        expect(draft.current.nodes).toEqual([]);
    });

    it('clears the redo branch after a new command', () => {
        let draft = createWorkflowDraft(emptySnapshot());
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });
        draft = undoWorkflowDraft(draft);
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-2'),
        });

        expect(canRedoWorkflowDraft(draft)).toBe(false);
        expect(draft.current.nodes.map((node) => node.id)).toEqual(['log-2']);
    });

    it('keeps React Flow node measurements in live state without making the draft dirty', () => {
        let draft = createWorkflowDraft({
            ...emptySnapshot(),
            nodes: [logNode('log-1')],
        });

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'nodes-change',
            changes: [
                {
                    id: 'log-1',
                    type: 'dimensions',
                    dimensions: { width: 208, height: 105 },
                },
            ],
        });

        expect(draft.current.nodes[0]?.measured).toEqual({ width: 208, height: 105 });
        expect(draft.revision).toBe(0);
        expect(isWorkflowDraftDirty(draft)).toBe(false);
    });

    it('keeps React Flow edge selection in live state without making the draft dirty', () => {
        let draft = createWorkflowDraft({
            ...emptySnapshot(),
            nodes: [logNode('source'), logNode('target')],
            edges: [{ id: 'edge-1', source: 'source', target: 'target' }],
        });

        draft = applyWorkflowDraftCommand(draft, {
            kind: 'edges-change',
            changes: [{ id: 'edge-1', type: 'select', selected: true }],
        });

        expect(draft.current.edges[0]?.selected).toBe(true);
        expect(draft.revision).toBe(0);
        expect(isWorkflowDraftDirty(draft)).toBe(false);
    });

    it('guards async saves, preserves failures for retry, and resets the baseline on success', () => {
        let draft = createWorkflowDraft(emptySnapshot());
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });

        const pending = beginWorkflowDraftSave(draft);
        expect(isWorkflowDraftSavePending(pending)).toBe(true);
        expect(beginWorkflowDraftSave(pending)).toBe(pending);
        if (pending.saveState.status !== 'pending') throw new Error('Expected a pending save.');
        const pendingAttemptId = pending.saveState.attemptId;

        const diagnostic: WorkflowDraftDiagnostic = {
            severity: 'error',
            code: 'invalid_pipeline',
            target: { kind: 'pipeline' },
            message: 'The Workflow file could not be replaced.',
        };
        const failed = rejectWorkflowDraftSave(
            pending,
            pendingAttemptId,
            'Could not save Workflow.',
            [diagnostic],
        );

        expect(failed.saveState).toEqual({
            status: 'failure',
            revision: pending.revision,
            attemptId: pendingAttemptId,
            error: 'Could not save Workflow.',
            diagnostics: [diagnostic],
        });
        expect(isWorkflowDraftDirty(failed)).toBe(true);

        const retry = beginWorkflowDraftSave(failed);
        if (retry.saveState.status !== 'pending')
            throw new Error('Expected a retry to be pending.');
        const saved = completeWorkflowDraftSave(retry, retry.saveState.attemptId);

        expect(saved.saveState).toEqual({
            status: 'success',
            revision: retry.revision,
            attemptId: retry.saveState.attemptId,
        });
        expect(isWorkflowDraftDirty(saved)).toBe(false);
    });

    it('ignores completion and rejection from a different save attempt', () => {
        let draft = createWorkflowDraft(emptySnapshot());
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });

        const pending = beginWorkflowDraftSave(draft);
        const otherPending = beginWorkflowDraftSave(createWorkflowDraft(emptySnapshot()));
        if (pending.saveState.status !== 'pending' || otherPending.saveState.status !== 'pending') {
            throw new Error('Expected both saves to be pending.');
        }

        expect(completeWorkflowDraftSave(pending, otherPending.saveState.attemptId)).toBe(pending);
        expect(
            rejectWorkflowDraftSave(pending, otherPending.saveState.attemptId, 'Stale', []),
        ).toBe(pending);
    });
});
