import { type DragEvent, type ReactElement, useId, useState } from 'react';

import { cn } from '../../lib/utils.js';
import { useBuilderStore } from '../builder-store.js';
import { NODE_DRAG_MIME } from '../constants.js';
import {
    CATEGORIES,
    CATEGORY_TEXT,
    DEFAULT_NODE_CATALOG,
    type NodeCatalogEntry,
    type NodeCategory,
    serializeNodeCatalogEntry,
} from '../node-catalog.js';

function nodeCatalogEntryKey(entry: NodeCatalogEntry): string {
    return `${entry.pluginId ?? 'builtin'}:${entry.type}`;
}

export function NodePalette(): ReactElement {
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
                    onAdd={addNode}
                />
            ))}
        </nav>
    );
}

function PaletteCategory({
    category,
    label,
    onAdd,
}: {
    readonly category: NodeCategory;
    readonly label: string;
    readonly onAdd: (entry: NodeCatalogEntry) => void;
}): ReactElement {
    const items = DEFAULT_NODE_CATALOG.entries.filter(
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
                'group flex cursor-grab appearance-none flex-col gap-0.5 border border-veil/40 bg-obsidian-ink/60 px-3 py-2 text-left transition-colors hover:border-gilt/60',
                'active:cursor-grabbing',
            )}
        >
            <span
                className={cn(
                    'text-sm tracking-wide text-parchment group-hover:text-gilt',
                    CATEGORY_TEXT[entry.category],
                )}
            >
                {entry.label}
            </span>
            <span className="font-data text-[10px] text-veil-foreground">{entry.type}</span>
            <span id={`${entryKey}-palette-description`} className="sr-only">
                {entry.description} Press Enter or Space to add this Node without dragging.
            </span>
        </button>
    );
}
