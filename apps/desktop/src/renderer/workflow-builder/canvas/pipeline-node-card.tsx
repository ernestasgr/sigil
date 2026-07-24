import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../lib/utils.js';
import type { BuilderRFNode } from '../builder-store.js';
import { useBuilderStore } from '../builder-store.js';
import {
    CATEGORY_ACCENT_BG,
    CATEGORY_TEXT,
    DEFAULT_NODE_CATALOG,
    isPluginNodeSpec,
    type NodeCatalog,
    nodeOutputPortLabel,
    resolveNodeCatalogEntry,
} from '../node-catalog.js';

// A single small top-left chamfer — repeated per node, so it stays light:
// no nested ring, just a clipped corner (see components/sigil-frame.tsx for
// the heavier structural-panel version of the same idea).
//
// Two things don't survive a plain `clip-path` on the node's own root:
//
// 1. `border` / `border-t` are strokes drawn on the *unclipped* box, then
//    cut by the polygon. Near the corner the stroke only partially overlaps
//    the visible chamfer, so it reads as broken off instead of following the
//    cut edge. Fix: trace the corner with a filled ring (a padded div clipped
//    to the same polygon) instead of a border — a fill clips cleanly, a
//    stroke doesn't.
// 2. React Flow's Handles are meant to straddle the node's edge (half in,
//    half out). `clip-path` clips *all* descendants to the polygon, same as
//    `overflow: hidden`, so the outer half of every Handle was being sliced
//    off. Fix: keep the Handles as siblings of the clipped layer, on the
//    unclipped root, so they're never inside the clip region.
const NODE_CHAMFER = 8;
const NODE_RING_WIDTH = 1;

function chamferClip(cut: number): string {
    return `polygon(${cut}px 0, 100% 0, 100% 100%, 0 100%, 0 ${cut}px)`;
}

const RING_CLIP: CSSProperties = { clipPath: chamferClip(NODE_CHAMFER) };
const CONTENT_CLIP: CSSProperties = { clipPath: chamferClip(NODE_CHAMFER - NODE_RING_WIDTH) };

export function PipelineNodeCard({
    id,
    data,
    selected,
    nodeCatalog = DEFAULT_NODE_CATALOG,
}: NodeProps<BuilderRFNode> & { readonly nodeCatalog?: NodeCatalog }): ReactElement {
    const spec = data;
    const def = resolveNodeCatalogEntry(spec, nodeCatalog);
    const visiblePorts = def.outputPorts === 'dynamic' ? [] : def.outputPorts;
    const showInput = def.isTrigger !== true;
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
            className="relative min-w-52 font-ui"
        >
            {/* Ring: traces the chamfer as a fill, so the cut corner reads as a
                deliberate edge instead of a border stroke stopping short. */}
            <div
                className={cn('h-full w-full', selected ? 'bg-gilt' : 'bg-veil/40')}
                style={{ ...RING_CLIP, padding: NODE_RING_WIDTH }}
            >
                <div className="flex h-full flex-col bg-obsidian-ink/95" style={CONTENT_CLIP}>
                    <div
                        className={cn('h-[3px] shrink-0', CATEGORY_ACCENT_BG[def.category])}
                        style={CONTENT_CLIP}
                    />
                    <header className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    'text-[10px] tracking-widest uppercase',
                                    CATEGORY_TEXT[def.category],
                                )}
                            >
                                {def.source === 'plugin' ? 'plugin' : def.category}
                            </span>
                        </div>
                        <span className="text-sm tracking-wide text-parchment">{def.label}</span>
                        <span className="font-data text-[10px] text-veil-foreground">
                            {spec.type}
                        </span>
                        {isPluginNodeSpec(spec) ? (
                            <span className="font-data text-[10px] text-gilt">{spec.pluginId}</span>
                        ) : null}
                    </header>
                    <div className="flex flex-col gap-1 px-4 pb-3">
                        {visiblePorts.map((port) => {
                            const label = nodeOutputPortLabel(spec, port, nodeCatalog);
                            return (
                                <div
                                    key={port}
                                    className="relative flex items-center justify-end pr-2 font-data text-[10px] text-veil-foreground"
                                >
                                    <span>{label}</span>
                                    <Handle
                                        id={port}
                                        type="source"
                                        position={Position.Right}
                                        aria-label={`${def.label} output ${label}`}
                                        className="h-2.5! w-2.5! border-gilt! bg-obsidian-ink!"
                                    />
                                </div>
                            );
                        })}
                        {def.authoring === 'read-only' ? (
                            <span className="font-data text-[10px] text-old-blood-foreground">
                                Read-only authoring
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
            {/* The input handle lives outside the clipped layers above: it's
                meant to straddle the node's left edge, and clip-path would
                slice off its outer half (same as overflow: hidden). Output
                handles stay nested in their row above — they sit far enough
                inside the padding that the clip never reaches them, and
                nesting is what gives each one its own row's vertical
                position. */}
            {showInput ? (
                <Handle type="target" position={Position.Left} aria-label={`${def.label} input`} />
            ) : null}
        </div>
    );
}
