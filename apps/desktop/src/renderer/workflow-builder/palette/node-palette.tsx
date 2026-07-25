import type { CSSProperties, DragEvent, ReactElement } from 'react';
import { useId, useState } from 'react';

import { cn } from '../../lib/utils.js';
import { useBuilderStore } from '../builder-store.js';
import { NODE_DRAG_MIME } from '../constants.js';
import {
    CATEGORIES,
    CATEGORY_ACCENT_BG,
    CATEGORY_TEXT,
    DEFAULT_NODE_CATALOG,
    type NodeCatalog,
    type NodeCatalogEntry,
    type NodeCategory,
    serializeNodeCatalogEntry,
} from '../node-catalog.js';

// The same light-frame idea as PipelineNodeCard's canvas nodes (a single
// top-left chamfer traced by a fill, not a border — see that file for why
// a plain `border` doesn't survive a clip-path cleanly), scaled down for a
// list row. Keeping the palette and the canvas cards visually related
// means a Node doesn't change families the moment it's dropped.
const PALETTE_ITEM_CHAMFER = 6;
const PALETTE_ITEM_RING_WIDTH = 1;

function paletteChamferClip(cut: number): string {
    return `polygon(${cut}px 0, 100% 0, 100% 100%, 0 100%, 0 ${cut}px)`;
}

const PALETTE_RING_CLIP: CSSProperties = { clipPath: paletteChamferClip(PALETTE_ITEM_CHAMFER) };
const PALETTE_CONTENT_CLIP: CSSProperties = {
    clipPath: paletteChamferClip(PALETTE_ITEM_CHAMFER - PALETTE_ITEM_RING_WIDTH),
};

function nodeCatalogEntryKey(entry: NodeCatalogEntry): string {
    return `${entry.pluginId ?? 'builtin'}:${entry.type}`;
}

export function NodePalette({
    catalog = DEFAULT_NODE_CATALOG,
}: {
    readonly catalog?: NodeCatalog;
}): ReactElement {
    const titleId = useId();
    const [announcement, setAnnouncement] = useState('');
    const addNodeFromPalette = useBuilderStore((state) => state.addNodeFromPalette);

    const addNode = (entry: NodeCatalogEntry): void => {
        addNodeFromPalette(entry);
        setAnnouncement(
            `${entry.label} Node added to the canvas. The Inspector is ready for editing.`,
        );
    };

    return (
        <nav className="flex h-full flex-col gap-5 overflow-auto p-4" aria-labelledby={titleId}>
            <h2 id={titleId} className="font-display text-gilt text-xs tracking-[0.3em] uppercase">
                Node Library
            </h2>
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {announcement}
            </p>
            {CATEGORIES.map((category) => (
                <PaletteCategory
                    key={category.id}
                    category={category.id}
                    label={category.label}
                    catalog={catalog}
                    onAdd={addNode}
                />
            ))}
        </nav>
    );
}

function PaletteCategory({
    category,
    label,
    catalog,
    onAdd,
}: {
    readonly category: NodeCategory;
    readonly label: string;
    readonly catalog: NodeCatalog;
    readonly onAdd: (entry: NodeCatalogEntry) => void;
}): ReactElement {
    const items = catalog.entries.filter(
        (entry) =>
            entry.category === category && entry.showInPalette && entry.authoring === 'editable',
    );
    return (
        <section className="flex flex-col gap-2">
            <h3 className="font-ui text-veil-foreground text-[10px] tracking-widest uppercase">
                {label}
            </h3>
            <div className="flex flex-col gap-1.5">
                {items.map((entry) => (
                    <PaletteItem key={nodeCatalogEntryKey(entry)} entry={entry} onAdd={onAdd} />
                ))}
            </div>
        </section>
    );
}

function PaletteItem({
    entry,
    onAdd,
}: {
    readonly entry: NodeCatalogEntry;
    readonly onAdd: (entry: NodeCatalogEntry) => void;
}): ReactElement {
    const entryKey = nodeCatalogEntryKey(entry);
    const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData(NODE_DRAG_MIME, serializeNodeCatalogEntry(entry));
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <button
            type="button"
            draggable
            onDragStart={onDragStart}
            title={entry.description}
            onClick={() => onAdd(entry)}
            aria-label={`Add ${entry.label} Node`}
            aria-describedby={`${entryKey}-palette-description`}
            aria-keyshortcuts="Enter Space"
            className={cn(
                'group block w-full cursor-grab appearance-none bg-veil/40 p-px text-left transition-colors hover:bg-gilt/60 focus-visible:bg-gilt/60',
                'active:cursor-grabbing',
            )}
            style={PALETTE_RING_CLIP}
        >
            <span className="flex flex-col gap-0.5 bg-obsidian-ink/70" style={PALETTE_CONTENT_CLIP}>
                <span
                    aria-hidden="true"
                    className={cn('block h-[2px] w-full', CATEGORY_ACCENT_BG[entry.category])}
                />
                <span className="flex flex-col gap-0.5 px-3 pt-1.5 pb-2">
                    <span
                        className={cn(
                            'text-sm tracking-wide text-parchment group-hover:text-gilt',
                            CATEGORY_TEXT[entry.category],
                        )}
                    >
                        {entry.label}
                    </span>
                    <span className="font-data text-[10px] text-veil-foreground">{entry.type}</span>
                </span>
            </span>
            <span id={`${entryKey}-palette-description`} className="sr-only">
                {entry.description} Press Enter or Space to add this Node without dragging.
            </span>
        </button>
    );
}
