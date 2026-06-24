import {
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    type NodeTypes,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type DragEvent, type ReactElement, useCallback } from 'react';

import { BUILDER_NODE_TYPE, useBuilderStore } from '../builder-store.js';
import { isNodeType } from '../node-registry.js';
import { NODE_DRAG_MIME } from '../palette/node-palette.js';
import { PipelineNodeCard } from './pipeline-node-card.js';

const NODE_TYPES: NodeTypes = { [BUILDER_NODE_TYPE]: PipelineNodeCard };

const DEFAULT_EDGE_OPTIONS = {
    style: { stroke: '#C9A227', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#C9A227' },
} as const;

export function WorkflowCanvas(): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const onNodesChange = useBuilderStore((state) => state.onNodesChange);
    const onEdgesChange = useBuilderStore((state) => state.onEdgesChange);
    const connect = useBuilderStore((state) => state.connect);
    const selectNode = useBuilderStore((state) => state.selectNode);
    const addNode = useBuilderStore((state) => state.addNode);
    const { screenToFlowPosition } = useReactFlow();

    const onDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const type = event.dataTransfer.getData(NODE_DRAG_MIME);
            if (!isNodeType(type)) return;
            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            addNode(type, position);
        },
        [screenToFlowPosition, addNode],
    );

    const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    return (
        <div className="sigil-ley-line-field h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
                nodes={[...nodes]}
                edges={[...edges]}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={connect}
                onNodeClick={(_event, node) => selectNode(node.id)}
                onPaneClick={() => selectNode(null)}
                nodeTypes={NODE_TYPES}
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
        </div>
    );
}
