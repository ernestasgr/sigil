import type { CompiledPipeline } from '@sigil/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuilderStore } from './builder-store.js';
import type {
    WorkflowDraftDiagnostic,
    WorkflowDraftSaveCommand,
    WorkflowDraftSaveResult,
} from './workflow-draft.js';

describe('useBuilderStore', () => {
    beforeEach(() => {
        useBuilderStore.getState().clear();
    });

    it('addNode creates a node with a default spec, selects it, and returns its id', () => {
        const id = useBuilderStore.getState().addNode('log', { x: 10, y: 20 });

        const state = useBuilderStore.getState();
        expect(state.nodes).toHaveLength(1);
        expect(state.nodes[0].id).toBe(id);
        expect(state.nodes[0].position).toEqual({ x: 10, y: 20 });
        expect(state.nodes[0].data.type).toBe('log');
        expect(state.selectedNodeId).toBe(id);
    });

    it('addNode gives each node a unique id', () => {
        const a = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });
        const b = useBuilderStore.getState().addNode('delay', { x: 0, y: 0 });
        expect(a).not.toBe(b);
    });

    it('addNode gives each node its own config copy, not the shared descriptor default', () => {
        const a = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });
        const b = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });

        const { nodes } = useBuilderStore.getState();
        expect(nodes).toHaveLength(2);
        const nodeA = nodes[0];
        const nodeB = nodes[1];
        expect(nodeA.id).toBe(a);
        expect(nodeB.id).toBe(b);

        expect(nodeA.data.config).not.toBe(nodeB.data.config);
        expect(nodeA.data.config).toEqual(nodeB.data.config);
    });

    it('adds a palette Node with a readable position and selects it', () => {
        const firstId = useBuilderStore.getState().addNodeFromPalette('manual-trigger');
        const secondId = useBuilderStore.getState().addNodeFromPalette('log');

        const state = useBuilderStore.getState();
        expect(state.selectedNodeId).toBe(secondId);
        expect(state.nodes.find((node) => node.id === firstId)?.position).toEqual({
            x: 40,
            y: 40,
        });
        expect(state.nodes.find((node) => node.id === secondId)?.position).toEqual({
            x: 320,
            y: 40,
        });
    });

    it('connect adds an edge carrying the source port from sourceHandle', () => {
        const source = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const target = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });

        useBuilderStore.getState().connect({
            source,
            target,
            sourceHandle: 'out',
            targetHandle: null,
        });

        const edges = useBuilderStore.getState().edges;
        expect(edges).toHaveLength(1);
        expect(edges[0].source).toBe(source);
        expect(edges[0].target).toBe(target);
        expect(edges[0].sourceHandle).toBe('out');
    });

    it('connect ignores an incomplete connection with no sourceHandle', () => {
        const source = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const target = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });

        useBuilderStore.getState().connect({
            source,
            target,
            sourceHandle: null,
            targetHandle: null,
        });

        expect(useBuilderStore.getState().edges).toHaveLength(0);
    });

    it('removeNode removes the node, its connected edges, and clears selection', () => {
        const a = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const b = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source: a, target: b, sourceHandle: 'out', targetHandle: null });
        useBuilderStore.getState().selectNode(a);

        useBuilderStore.getState().removeNode(a);

        const state = useBuilderStore.getState();
        expect(state.nodes.map((n) => n.id)).toEqual([b]);
        expect(state.edges).toHaveLength(0);
        expect(state.selectedNodeId).toBeNull();
    });

    it('selectNode sets and clears the selected node', () => {
        const id = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });

        useBuilderStore.getState().selectNode(null);
        expect(useBuilderStore.getState().selectedNodeId).toBeNull();

        useBuilderStore.getState().selectNode(id);
        expect(useBuilderStore.getState().selectedNodeId).toBe(id);
    });

    it('updateSpec replaces the config and prunes edges whose port is no longer valid', () => {
        const sw = useBuilderStore.getState().addNode('switch', { x: 0, y: 0 });
        const log = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        const caseId = 'case-1';
        useBuilderStore
            .getState()
            .connect({ source: sw, target: log, sourceHandle: caseId, targetHandle: null });
        useBuilderStore.getState().connect({
            source: sw,
            target: log,
            sourceHandle: 'default',
            targetHandle: null,
        });
        expect(useBuilderStore.getState().edges).toHaveLength(2);

        useBuilderStore.getState().updateSpec(sw, {
            type: 'switch',
            config: { target: 'event', cases: [{ id: 'case-png', value: 'png' }] },
        });

        const state = useBuilderStore.getState();
        expect(state.nodes[0].data.type).toBe('switch');
        if (!('pluginId' in state.nodes[0].data) && state.nodes[0].data.type === 'switch') {
            expect(state.nodes[0].data.config.cases).toEqual([{ id: 'case-png', value: 'png' }]);
        }
        const ports = state.edges.map((e) => e.sourceHandle);
        expect(ports).toEqual(['default']);
    });

    it('keeps a connected Edge while a Switch case value is edited through an empty intermediate state', () => {
        const sw = useBuilderStore.getState().addNode('switch', { x: 0, y: 0 });
        const log = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        const caseId = 'case-1';
        useBuilderStore
            .getState()
            .connect({ source: sw, target: log, sourceHandle: caseId, targetHandle: null });

        useBuilderStore.getState().updateSpec(sw, {
            type: 'switch',
            config: { target: 'event', cases: [{ id: caseId, value: 'p' }] },
        });
        useBuilderStore.getState().updateSpec(sw, {
            type: 'switch',
            config: { target: 'event', cases: [{ id: caseId, value: '' }] },
        });

        expect(useBuilderStore.getState().edges).toEqual([
            expect.objectContaining({ source: sw, target: log, sourceHandle: caseId }),
        ]);

        const result = useBuilderStore.getState().compile();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'empty_match_value',
                        nodeId: sw,
                        fieldPath: 'config.cases[0].value',
                    }),
                ]),
            );
        }
    });

    it('compile returns a valid pipeline for a single default Trigger Node', () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });

        const result = useBuilderStore.getState().compile();

        expect(result.ok).toBe(true);
    });

    it('compile returns an error for an invalid graph', () => {
        const log = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });
        useBuilderStore.getState().updateSpec(log, { type: 'log', config: { message: '' } });

        const result = useBuilderStore.getState().compile();

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/message/);
        }
    });

    it('exposes structured validation diagnostics with Node and field context', () => {
        const sw = useBuilderStore.getState().addNode('switch', { x: 0, y: 0 });
        useBuilderStore.getState().updateSpec(sw, {
            type: 'switch',
            config: {
                target: 'event',
                cases: [
                    { id: 'case-a', value: 'pdf' },
                    { id: 'case-b', value: 'pdf' },
                ],
            },
        });

        const validation = useBuilderStore.getState().validation;
        expect(validation.status).toBe('invalid');
        if (validation.status === 'invalid') {
            expect(validation.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'duplicate_match_value',
                        target: { kind: 'node', nodeId: sw },
                        fieldPath: 'config.cases[1].value',
                        repairHint: expect.any(String),
                    }),
                ]),
            );
        }
    });

    it('onNodesChange with a remove change drops the node, its edges, and clears selection', () => {
        const a = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const b = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source: a, target: b, sourceHandle: 'out', targetHandle: null });
        useBuilderStore.getState().selectNode(a);

        useBuilderStore.getState().onNodesChange([{ id: a, type: 'remove' }]);

        const state = useBuilderStore.getState();
        expect(state.nodes.map((n) => n.id)).toEqual([b]);
        expect(state.edges).toHaveLength(0);
        expect(state.selectedNodeId).toBeNull();
    });

    it('onEdgesChange with a remove change drops the edge', () => {
        const a = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const b = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source: a, target: b, sourceHandle: 'out', targetHandle: null });
        const edgeId = useBuilderStore.getState().edges[0].id;

        useBuilderStore.getState().onEdgesChange([{ id: edgeId, type: 'remove' }]);

        expect(useBuilderStore.getState().edges).toHaveLength(0);
    });

    it('reports dirty state against the current baseline and resets it after saving', () => {
        const state = useBuilderStore.getState();

        expect(state.revision).toBe(0);
        expect(state.dirty).toBe(false);
        expect(state.canLeave()).toBe(true);

        state.addNode('log', { x: 0, y: 0 });

        expect(useBuilderStore.getState().dirty).toBe(true);
        expect(useBuilderStore.getState().canLeave()).toBe(false);

        useBuilderStore.getState().markSaved();

        expect(useBuilderStore.getState().dirty).toBe(false);
        expect(useBuilderStore.getState().isDirty).toBe(false);
        expect(useBuilderStore.getState().canLeave()).toBe(true);
        expect(useBuilderStore.getState().canUndo).toBe(true);

        useBuilderStore.getState().setPipelineName('Renamed');
        expect(useBuilderStore.getState().dirty).toBe(true);
        useBuilderStore.getState().setPipelineName('');
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('undoes and redoes node, edge, configuration, and position edits', () => {
        const trigger = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const log = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source: trigger, target: log, sourceHandle: 'out', targetHandle: null });

        useBuilderStore.getState().updateSpec(log, {
            type: 'log',
            config: { message: 'reversible edit' },
        });
        useBuilderStore
            .getState()
            .onNodesChange([{ id: log, type: 'position', position: { x: 200, y: 20 } }]);

        expect(useBuilderStore.getState().nodes.find((node) => node.id === log)?.position).toEqual({
            x: 200,
            y: 20,
        });
        expect(useBuilderStore.getState().canUndo).toBe(true);

        useBuilderStore.getState().undo();
        expect(useBuilderStore.getState().nodes.find((node) => node.id === log)?.position).toEqual({
            x: 100,
            y: 0,
        });

        useBuilderStore.getState().undo();
        expect(
            useBuilderStore.getState().nodes.find((node) => node.id === log)?.data.config,
        ).toEqual({
            message: 'Log message',
        });

        useBuilderStore.getState().redo();
        expect(
            useBuilderStore.getState().nodes.find((node) => node.id === log)?.data.config,
        ).toEqual({
            message: 'reversible edit',
        });
        useBuilderStore.getState().redo();
        expect(useBuilderStore.getState().nodes.find((node) => node.id === log)?.position).toEqual({
            x: 200,
            y: 20,
        });

        const edgeId = useBuilderStore.getState().edges[0]?.id;
        expect(edgeId).toBeDefined();
        if (!edgeId) return;

        useBuilderStore.getState().removeEdge(edgeId);
        expect(useBuilderStore.getState().edges).toHaveLength(0);
        useBuilderStore.getState().undo();
        expect(useBuilderStore.getState().edges.map((edge) => edge.id)).toEqual([edgeId]);

        useBuilderStore.getState().removeNode(trigger);
        expect(useBuilderStore.getState().nodes.map((node) => node.id)).toEqual([log]);
        useBuilderStore.getState().undo();
        expect(useBuilderStore.getState().nodes.map((node) => node.id)).toEqual([trigger, log]);
        expect(useBuilderStore.getState().edges.map((edge) => edge.id)).toEqual([edgeId]);
    });

    it('does not create a dirty revision for selection-only changes', () => {
        const id = useBuilderStore.getState().addNode('log', { x: 0, y: 0 });
        useBuilderStore.getState().markSaved();
        const revision = useBuilderStore.getState().revision;

        useBuilderStore.getState().onNodesChange([{ id, type: 'select', selected: true }]);

        expect(useBuilderStore.getState().selectedNodeId).toBe(id);
        expect(useBuilderStore.getState().revision).toBe(revision);
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('keeps React Flow dimensions and edge selection in the controlled state', () => {
        const source = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        const target = useBuilderStore.getState().addNode('log', { x: 100, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source, target, sourceHandle: 'out', targetHandle: null });
        useBuilderStore.getState().markSaved();
        const revision = useBuilderStore.getState().revision;
        const edgeId = useBuilderStore.getState().edges[0]?.id;
        expect(edgeId).toBeDefined();
        if (!edgeId) return;

        useBuilderStore
            .getState()
            .onNodesChange([
                { id: source, type: 'dimensions', dimensions: { width: 208, height: 105 } },
            ]);
        useBuilderStore.getState().onEdgesChange([{ id: edgeId, type: 'select', selected: true }]);

        const state = useBuilderStore.getState();
        expect(state.nodes.find((node) => node.id === source)?.measured).toEqual({
            width: 208,
            height: 105,
        });
        expect(state.edges.find((edge) => edge.id === edgeId)?.selected).toBe(true);
        expect(state.revision).toBe(revision);
        expect(state.dirty).toBe(false);

        useBuilderStore.getState().onEdgesChange([{ id: edgeId, type: 'remove' }]);
        expect(useBuilderStore.getState().edges).toHaveLength(0);
    });

    it('loads a saved baseline including positions and tracks later node movement', () => {
        const pipeline: CompiledPipeline = {
            id: 'pipeline-loaded',
            workflowId: 'workflow-loaded',
            schemaVersion: 1,
            nodes: [{ id: 'log', type: 'log', config: { message: 'Loaded' } }],
            edges: [],
        };

        useBuilderStore
            .getState()
            .loadPipeline(pipeline, 'Loaded Workflow', { log: { x: 40, y: 60 } });

        expect(useBuilderStore.getState().dirty).toBe(false);
        expect(useBuilderStore.getState().revision).toBe(0);
        expect(useBuilderStore.getState().nodes[0]?.position).toEqual({ x: 40, y: 60 });

        useBuilderStore
            .getState()
            .onNodesChange([{ id: 'log', type: 'position', position: { x: 80, y: 100 } }]);

        expect(useBuilderStore.getState().dirty).toBe(true);
        useBuilderStore.getState().undo();
        expect(useBuilderStore.getState().dirty).toBe(false);
        expect(useBuilderStore.getState().nodes[0]?.position).toEqual({ x: 40, y: 60 });
    });

    it('preserves a bundled Plugin Node through load, edit, compile, and save', async () => {
        const pipeline: CompiledPipeline = {
            id: 'pipeline-plugin',
            workflowId: 'workflow-plugin',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'file-trigger',
                    type: 'file-watcher',
                    pluginId: 'com.sigil.file-watcher',
                    config: {
                        path: '/tmp',
                        recursive: true,
                        events: ['file.created'],
                    },
                },
                { id: 'log', type: 'log', config: { message: 'Loaded' } },
            ],
            edges: [{ id: 'edge-1', source: 'file-trigger', target: 'log', sourcePort: 'out' }],
        };

        useBuilderStore.getState().loadPipeline(pipeline, 'Plugin Workflow');

        expect(useBuilderStore.getState().nodes[0]?.data).toMatchObject({
            type: 'file-watcher',
            pluginId: 'com.sigil.file-watcher',
        });

        useBuilderStore.getState().updateSpec('file-trigger', {
            type: 'file-watcher',
            pluginId: 'com.sigil.file-watcher',
            config: {
                path: '/var/tmp',
                recursive: false,
                events: ['file.modified'],
            },
        });

        const compiled = useBuilderStore.getState().compile();
        expect(compiled.ok).toBe(true);
        if (compiled.ok) {
            expect(compiled.value.nodes[0]).toMatchObject({
                type: 'file-watcher',
                pluginId: 'com.sigil.file-watcher',
                config: {
                    path: '/var/tmp',
                    recursive: false,
                    events: ['file.modified'],
                },
            });
        }

        let savedPipeline: CompiledPipeline | undefined;
        const command: WorkflowDraftSaveCommand = vi.fn(
            async (request): Promise<WorkflowDraftSaveResult> => {
                savedPipeline = request.pipeline;
                return { ok: true };
            },
        );

        await expect(useBuilderStore.getState().save('Plugin Workflow', command)).resolves.toEqual({
            ok: true,
        });
        expect(savedPipeline?.nodes[0]).toMatchObject({
            type: 'file-watcher',
            pluginId: 'com.sigil.file-watcher',
            config: {
                path: '/var/tmp',
                recursive: false,
                events: ['file.modified'],
            },
        });
    });

    it('fills missing loaded positions with a deterministic topology layout', () => {
        const pipeline: CompiledPipeline = {
            id: 'pipeline-layout',
            workflowId: 'workflow-layout',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'trigger',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
                    },
                },
                { id: 'log', type: 'log', config: { message: 'Loaded' } },
            ],
            edges: [{ id: 'edge-1', source: 'trigger', target: 'log', sourcePort: 'out' }],
        };

        useBuilderStore.getState().loadPipeline(pipeline, 'Layout Workflow');

        const nodes = useBuilderStore.getState().nodes;
        expect(nodes.find((node) => node.id === 'trigger')?.position).toEqual({ x: 40, y: 40 });
        expect(nodes.find((node) => node.id === 'log')?.position.x).toBeGreaterThan(40);
    });

    it('clear resets the graph to empty', () => {
        useBuilderStore.getState().addNode('log', { x: 0, y: 0 });
        useBuilderStore
            .getState()
            .connect({ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: null });

        useBuilderStore.getState().clear();

        const state = useBuilderStore.getState();
        expect(state.nodes).toEqual([]);
        expect(state.edges).toEqual([]);
        expect(state.selectedNodeId).toBeNull();
    });

    it('submits one async save command at a time and resets the baseline after success', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('Draft Workflow');

        let resolvePending: ((result: WorkflowDraftSaveResult) => void) | undefined;
        const pendingResult = new Promise<WorkflowDraftSaveResult>((resolve) => {
            resolvePending = resolve;
        });
        const command = vi.fn(async () => pendingResult);

        const firstSave = useBuilderStore.getState().save('Draft Workflow', command);

        const pendingState = useBuilderStore.getState().saveState;
        expect(pendingState.status).toBe('pending');
        if (pendingState.status !== 'pending') throw new Error('Expected a pending save.');
        const firstAttemptId = pendingState.attemptId;
        expect(command).toHaveBeenCalledTimes(1);
        expect(command).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Draft Workflow',
                revision: 2,
                pipeline: expect.objectContaining({ workflowId: expect.any(String) }),
            }),
        );

        const duplicateSave = useBuilderStore.getState().save('Draft Workflow', command);
        await expect(duplicateSave).resolves.toEqual(
            expect.objectContaining({ ok: false, error: expect.stringMatching(/pending/i) }),
        );
        expect(command).toHaveBeenCalledTimes(1);

        resolvePending?.({ ok: true });
        await expect(firstSave).resolves.toEqual({ ok: true });

        expect(useBuilderStore.getState().saveState).toEqual({
            status: 'success',
            revision: 2,
            attemptId: firstAttemptId,
        });
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('ignores an older save after the draft is cleared', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('Cleared Workflow');

        let resolvePending: ((result: WorkflowDraftSaveResult) => void) | undefined;
        const pendingResult = new Promise<WorkflowDraftSaveResult>((resolve) => {
            resolvePending = resolve;
        });
        const oldSave = useBuilderStore.getState().save(
            'Cleared Workflow',
            vi.fn(async () => pendingResult),
        );

        useBuilderStore.getState().clear();
        resolvePending?.({ ok: true });
        await oldSave;

        expect(useBuilderStore.getState().saveState).toEqual({ status: 'idle' });
        expect(useBuilderStore.getState().nodes).toEqual([]);
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('ignores an older save after a different pipeline is loaded', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('Replaced Workflow');

        let resolvePending: ((result: WorkflowDraftSaveResult) => void) | undefined;
        const pendingResult = new Promise<WorkflowDraftSaveResult>((resolve) => {
            resolvePending = resolve;
        });
        const oldSave = useBuilderStore.getState().save(
            'Replaced Workflow',
            vi.fn(async () => pendingResult),
        );

        const loadedPipeline: CompiledPipeline = {
            id: 'pipeline-new',
            workflowId: 'workflow-new',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'loaded-trigger',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
                    },
                },
            ],
            edges: [],
        };
        useBuilderStore.getState().loadPipeline(loadedPipeline, 'Loaded Workflow');

        resolvePending?.({ ok: false, error: 'Stale save', diagnostics: [] });
        await oldSave;

        expect(useBuilderStore.getState().nodes.map((node) => node.id)).toEqual(['loaded-trigger']);
        expect(useBuilderStore.getState().pipelineName).toBe('Loaded Workflow');
        expect(useBuilderStore.getState().saveState).toEqual({ status: 'idle' });
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('does not let an older save settle a newer save attempt', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('Old Workflow');

        let resolveOld: ((result: WorkflowDraftSaveResult) => void) | undefined;
        const oldResult = new Promise<WorkflowDraftSaveResult>((resolve) => {
            resolveOld = resolve;
        });
        const oldSave = useBuilderStore.getState().save(
            'Old Workflow',
            vi.fn(async () => oldResult),
        );
        const oldPending = useBuilderStore.getState().saveState;
        if (oldPending.status !== 'pending')
            throw new Error('Expected the old save to be pending.');

        useBuilderStore.getState().clear();
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('New Workflow');

        let resolveNew: ((result: WorkflowDraftSaveResult) => void) | undefined;
        const newResult = new Promise<WorkflowDraftSaveResult>((resolve) => {
            resolveNew = resolve;
        });
        const newSave = useBuilderStore.getState().save(
            'New Workflow',
            vi.fn(async () => newResult),
        );
        const newPending = useBuilderStore.getState().saveState;
        if (newPending.status !== 'pending')
            throw new Error('Expected the new save to be pending.');
        expect(newPending.attemptId).not.toBe(oldPending.attemptId);

        resolveOld?.({ ok: true });
        await oldSave;

        expect(useBuilderStore.getState().saveState).toEqual({
            status: 'pending',
            revision: newPending.revision,
            attemptId: newPending.attemptId,
        });

        resolveNew?.({ ok: true });
        await newSave;
        expect(useBuilderStore.getState().saveState).toEqual({
            status: 'success',
            revision: newPending.revision,
            attemptId: newPending.attemptId,
        });
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('keeps structured command diagnostics visible and retries a failed save', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('Retry Workflow');

        const diagnostic: WorkflowDraftDiagnostic = {
            severity: 'error',
            code: 'invalid_pipeline',
            target: { kind: 'node', nodeId: 'trigger' },
            nodeId: 'trigger',
            fieldPath: 'config.eventName',
            message: 'The Trigger event is invalid.',
            repairHint: 'Choose a supported event name.',
        };
        const firstCommand = vi.fn(
            async (): Promise<WorkflowDraftSaveResult> => ({
                ok: false,
                error: 'The Workflow file could not be replaced.',
                diagnostics: [diagnostic],
            }),
        );

        await expect(
            useBuilderStore.getState().save('Retry Workflow', firstCommand),
        ).resolves.toEqual(
            expect.objectContaining({
                ok: false,
                diagnostics: [diagnostic],
            }),
        );
        expect(useBuilderStore.getState().saveState).toEqual({
            status: 'failure',
            revision: 2,
            attemptId: expect.any(String),
            error: 'The Workflow file could not be replaced.',
            diagnostics: [diagnostic],
        });
        expect(useBuilderStore.getState().dirty).toBe(true);

        const retryCommand = vi.fn(async (): Promise<WorkflowDraftSaveResult> => ({ ok: true }));
        await expect(
            useBuilderStore.getState().save('Retry Workflow', retryCommand),
        ).resolves.toEqual({ ok: true });

        expect(retryCommand).toHaveBeenCalledTimes(1);
        expect(useBuilderStore.getState().saveState).toEqual(
            expect.objectContaining({
                status: 'success',
                revision: 2,
                attemptId: expect.any(String),
            }),
        );
        expect(useBuilderStore.getState().dirty).toBe(false);
    });

    it('turns a thrown IPC command failure into a visible retryable save state', async () => {
        useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
        useBuilderStore.getState().setPipelineName('IPC Failure Workflow');

        const command = vi.fn(async (): Promise<WorkflowDraftSaveResult> => {
            throw new Error('Renderer IPC unavailable');
        });

        await expect(
            useBuilderStore.getState().save('IPC Failure Workflow', command),
        ).resolves.toEqual(
            expect.objectContaining({
                ok: false,
                error: 'Renderer IPC unavailable',
                diagnostics: [
                    expect.objectContaining({
                        kind: 'command',
                        operation: 'save',
                        code: 'save_command_failed',
                    }),
                ],
            }),
        );
        const saveState = useBuilderStore.getState().saveState;
        expect(saveState.status).toBe('failure');
        if (saveState.status === 'failure') {
            expect(saveState.error).toBe('Renderer IPC unavailable');
            expect(saveState.diagnostics).toEqual([
                expect.objectContaining({
                    kind: 'command',
                    operation: 'save',
                    code: 'save_command_failed',
                }),
            ]);
        }
    });
});
