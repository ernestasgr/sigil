import { outputPortLabelForNode, outputPortsForNode } from '@sigil/schema/nodes';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { ReactElement } from 'react';

import { cn } from '../../lib/utils.js';
import type { BuilderRFNode } from '../builder-store.js';
import { useBuilderStore } from '../builder-store.js';
import { CornerFlourish } from '../corner-flourish.js';
import { CATEGORY_TEXT, CATEGORY_TOP_ACCENT, nodeTypeDef } from '../node-registry.js';

const NODE_BASE_CLASS = 'relative min-w-52 border border-veil/40 bg-obsidian-ink/95 font-ui';

export function PipelineNodeCard({ id, data, selected }: NodeProps<BuilderRFNode>): ReactElement {
    const spec = data;
    const def = nodeTypeDef(spec.type);
    const ports = outputPortsForNode({ id, ...spec });
    const showInput = def.category !== 'trigger';
    const selectNode = useBuilderStore((state) => state.selectNode);

    return (
        // biome-ignore lint/a11y/useSemanticElements: React Flow owns the node shell; connection Handles prevent a native button wrapper.
        <div
            role="button"
            tabIndex={0}
            aria-label={`${def.label} Node`}
            aria-pressed={selected}
            onClick={() => selectNode(id)}
            onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                selectNode(id);
            }}
            className={cn(
                NODE_BASE_CLASS,
                CATEGORY_TOP_ACCENT[def.category],
                selected && 'border-gilt',
            )}
        >
            <CornerFlourish corner="tl" size={10} inset={4} opacity={0.55} />
            {showInput ? <Handle type="target" position={Position.Left} /> : null}
            <header className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'text-[10px] tracking-widest uppercase',
                            CATEGORY_TEXT[def.category],
                        )}
                    >
                        {def.category}
                    </span>
                </div>
                <span className="text-sm tracking-wide text-parchment">{def.label}</span>
                <span className="font-data text-[10px] text-veil-foreground">{spec.type}</span>
            </header>
            <div className="flex flex-col gap-1 px-4 pb-3">
                {ports.map((port) => (
                    <div
                        key={port}
                        className="relative flex items-center justify-end pr-2 font-data text-[10px] text-veil-foreground"
                    >
                        <span>{outputPortLabelForNode({ id, ...spec }, port)}</span>
                        <Handle
                            id={port}
                            type="source"
                            position={Position.Right}
                            className="!h-2.5 !w-2.5 !border-gilt !bg-obsidian-ink"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
