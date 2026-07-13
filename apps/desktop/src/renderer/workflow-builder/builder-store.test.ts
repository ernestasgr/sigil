import { beforeEach, describe, expect, it } from 'vitest';

import { useBuilderStore } from './builder-store.js';

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
        if (state.nodes[0].data.type === 'switch') {
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
});
