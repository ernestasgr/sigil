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

    it('guards async saves, preserves failures for retry, and resets the baseline on success', () => {
        let draft = createWorkflowDraft(emptySnapshot());
        draft = applyWorkflowDraftCommand(draft, {
            kind: 'add-node',
            node: logNode('log-1'),
        });

        const pending = beginWorkflowDraftSave(draft);
        expect(isWorkflowDraftSavePending(pending)).toBe(true);
        expect(beginWorkflowDraftSave(pending)).toBe(pending);

        const diagnostic: WorkflowDraftDiagnostic = {
            severity: 'error',
            code: 'invalid_pipeline',
            target: { kind: 'pipeline' },
            message: 'The Workflow file could not be replaced.',
        };
        const failed = rejectWorkflowDraftSave(pending, 'Could not save Workflow.', [diagnostic]);

        expect(failed.saveState).toEqual({
            status: 'failure',
            revision: pending.revision,
            error: 'Could not save Workflow.',
            diagnostics: [diagnostic],
        });
        expect(isWorkflowDraftDirty(failed)).toBe(true);

        const retry = beginWorkflowDraftSave(failed);
        const saved = completeWorkflowDraftSave(retry);

        expect(saved.saveState).toEqual({ status: 'success', revision: retry.revision });
        expect(isWorkflowDraftDirty(saved)).toBe(false);
    });
});
