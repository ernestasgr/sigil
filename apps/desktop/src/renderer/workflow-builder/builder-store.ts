import type { CompiledPipeline } from '@sigil/schema';
import type { NodeType, PipelineNode } from '@sigil/schema/nodes';
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
    type XYPosition,
} from '@xyflow/react';
import { create } from 'zustand';

import type { CompileResult, PipelineMeta } from './compile.js';
import { compileGraph } from './compile.js';
import { defaultNodeSpec, type NodeSpec } from './node-registry.js';

export type BuilderRFNode = Node<NodeSpec, 'sigil'>;
export const BUILDER_NODE_TYPE = 'sigil' as const;

export interface BuilderState {
    readonly nodes: readonly BuilderRFNode[];
    readonly edges: readonly Edge[];
    readonly selectedNodeId: string | null;
    readonly meta: PipelineMeta;
    readonly pipelineName: string;
    readonly addNode: (type: NodeType, position: XYPosition) => string;
    readonly updateSpec: (nodeId: string, spec: NodeSpec) => void;
    readonly removeNode: (nodeId: string) => void;
    readonly connect: (connection: Connection) => void;
    readonly removeEdge: (edgeId: string) => void;
    readonly selectNode: (nodeId: string | null) => void;
    readonly onNodesChange: (changes: readonly NodeChange<BuilderRFNode>[]) => void;
    readonly onEdgesChange: (changes: readonly EdgeChange[]) => void;
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

function freshMeta(): PipelineMeta {
    return { id: crypto.randomUUID(), workflowId: crypto.randomUUID() };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    meta: freshMeta(),
    pipelineName: '',

    addNode: (type, position) => {
        const id = crypto.randomUUID();
        const node: BuilderRFNode = {
            id,
            type: BUILDER_NODE_TYPE,
            position,
            data: defaultNodeSpec(type),
        };
        set((state) => ({
            nodes: [...state.nodes, node],
            selectedNodeId: id,
        }));
        return id;
    },

    updateSpec: (nodeId, spec) => {
        set((state) => {
            const nodes = state.nodes.map((node) =>
                node.id === nodeId ? { ...node, data: spec } : node,
            );
            const validPorts = new Set(outputPortsForNode({ id: nodeId, ...spec }));
            const edges = state.edges.filter(
                (edge) =>
                    edge.source !== nodeId ||
                    (edge.sourceHandle != null && validPorts.has(edge.sourceHandle)),
            );
            return { nodes, edges };
        });
    },

    removeNode: (nodeId) => {
        set((state) => ({
            nodes: state.nodes.filter((node) => node.id !== nodeId),
            edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        }));
    },

    connect: (connection) => {
        if (!connection.source || !connection.target || !connection.sourceHandle) return;
        set((state) => ({
            edges: addEdge(connection, [...state.edges]),
        }));
    },

    removeEdge: (edgeId) => {
        set((state) => ({
            edges: state.edges.filter((edge) => edge.id !== edgeId),
        }));
    },

    selectNode: (nodeId) => {
        set({ selectedNodeId: nodeId });
    },

    onNodesChange: (changes) => {
        set((state) => {
            const nodes = applyNodeChanges([...changes], [...state.nodes]);
            const removedIds = new Set(
                changes.filter((change) => change.type === 'remove').map((change) => change.id),
            );
            if (removedIds.size === 0) return { nodes };
            const edges = state.edges.filter(
                (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target),
            );
            const selectedNodeId =
                state.selectedNodeId !== null && removedIds.has(state.selectedNodeId)
                    ? null
                    : state.selectedNodeId;
            return { nodes, edges, selectedNodeId };
        });
    },

    onEdgesChange: (changes) => {
        set((state) => ({
            edges: applyEdgeChanges([...changes], [...state.edges]),
        }));
    },

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
        set({ nodes: [], edges: [], selectedNodeId: null, meta: freshMeta(), pipelineName: '' });
    },

    loadPipeline: (pipeline, name, positions) => {
        const nodes: BuilderRFNode[] = pipeline.nodes.map(
            (pn: PipelineNode): BuilderRFNode => ({
                id: pn.id,
                type: BUILDER_NODE_TYPE,
                position: positions?.[pn.id] ?? { x: 0, y: 0 },
                data: {
                    type: pn.type,
                    config: structuredClone(pn.config),
                    ...('pluginId' in pn ? { pluginId: pn.pluginId } : {}),
                } as NodeSpec,
            }),
        );
        const edges: Edge[] = pipeline.edges.map((pe) => ({
            id: pe.id,
            source: pe.source,
            target: pe.target,
            sourceHandle: pe.sourcePort,
            targetHandle: undefined,
        }));
        const meta: PipelineMeta = {
            id: pipeline.id,
            workflowId: pipeline.workflowId,
            name,
        };
        set({ nodes, edges, selectedNodeId: null, meta, pipelineName: name });
    },

    setPipelineName: (name) => {
        set({ pipelineName: name });
    },
}));
