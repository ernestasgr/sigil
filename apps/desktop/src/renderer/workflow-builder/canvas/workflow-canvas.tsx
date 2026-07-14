import {
    Controls,
    MarkerType,
    MiniMap,
    type NodeTypes,
    ReactFlow,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type DragEvent, type ReactElement, useCallback, useMemo } from 'react';

import { BUILDER_NODE_TYPE, useBuilderStore } from '../builder-store.js';
import { NODE_DRAG_MIME } from '../constants.js';
import {
    DEFAULT_NODE_CATALOG,
    type NodeCatalog,
    nodeCatalogEntryFromPaletteValue,
} from '../node-catalog.js';
import { PipelineNodeCard } from './pipeline-node-card.js';

const DEFAULT_EDGE_OPTIONS = {
    style: { stroke: '#C9A227', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#C9A227' },
} as const;

export function WorkflowCanvas({
    nodeCatalog = DEFAULT_NODE_CATALOG,
}: {
    readonly nodeCatalog?: NodeCatalog;
}): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
    const onNodesChange = useBuilderStore((state) => state.onNodesChange);
    const onEdgesChange = useBuilderStore((state) => state.onEdgesChange);
    const connect = useBuilderStore((state) => state.connect);
    const selectNode = useBuilderStore((state) => state.selectNode);
    const addNode = useBuilderStore((state) => state.addNode);
    const { screenToFlowPosition } = useReactFlow();
    const nodeTypes = useMemo<NodeTypes>(
        () => ({
            [BUILDER_NODE_TYPE]: (props) => (
                <PipelineNodeCard {...props} nodeCatalog={nodeCatalog} />
            ),
        }),
        [nodeCatalog],
    );

    const onDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const entry = nodeCatalogEntryFromPaletteValue(
                event.dataTransfer.getData(NODE_DRAG_MIME),
                nodeCatalog,
            );
            if (!entry) return;
            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            addNode(entry, position);
        },
        [screenToFlowPosition, addNode, nodeCatalog],
    );

    const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    return (
        <section
            className="sigil-ley-line-field h-full w-full"
            onDrop={onDrop}
            onDragOver={onDragOver}
            aria-label="Workflow canvas"
            aria-describedby="workflow-canvas-help"
        >
            <p id="workflow-canvas-help" className="sr-only">
                Select a Node with Enter or Space. Connect Nodes by dragging from an output port to
                an input port, or use the Node Library to add Nodes without dragging.
            </p>
            <ReactFlow
                nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
                edges={[...edges]}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={connect}
                onNodeClick={(_event, node) => selectNode(node.id)}
                onPaneClick={() => selectNode(null)}
                nodeTypes={nodeTypes}
                defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                deleteKeyCode={['Backspace', 'Delete']}
                fitView
                className="sigil-flow-surface"
            >
                <Controls className="!border-gilt/40 !bg-obsidian-ink/80" showInteractive={false} />
                <MiniMap
                    pannable
                    maskColor="rgba(14,12,16,0.7)"
                    style={{ backgroundColor: '#0E0C10' }}
                    nodeColor={(node) => (node.selected ? '#C9A227' : '#4B4554')}
                />
            </ReactFlow>
        </section>
    );
}
