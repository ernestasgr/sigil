import type { NodeType } from '@sigil/schema/nodes';
import { type DragEvent, type ReactElement, useId, useState } from 'react';

import { cn } from '../../lib/utils.js';
import { useBuilderStore } from '../builder-store.js';
import { NODE_DRAG_MIME } from '../constants.js';
import { CATEGORIES, CATEGORY_TEXT, NODE_TYPES, type NodeCategory } from '../node-registry.js';

export function NodePalette(): ReactElement {
    const titleId = useId();
    const [announcement, setAnnouncement] = useState('');
    const addNodeFromPalette = useBuilderStore((state) => state.addNodeFromPalette);

    const addNode = (type: NodeType, label: string): void => {
        addNodeFromPalette(type);
        setAnnouncement(`${label} Node added to the canvas. The Inspector is ready for editing.`);
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
    readonly onAdd: (type: NodeType, label: string) => void;
}): ReactElement {
    const items = NODE_TYPES.filter((def) => def.category === category);
    return (
        <section className="flex flex-col gap-2">
            <h3 className="font-ui text-veil-foreground text-[10px] tracking-widest uppercase">
                {label}
            </h3>
            <div className="flex flex-col gap-1.5">
                {items.map((def) => (
                    <PaletteItem
                        key={def.type}
                        type={def.type}
                        label={def.label}
                        description={def.description}
                        category={def.category}
                        onAdd={onAdd}
                    />
                ))}
            </div>
        </section>
    );
}

function PaletteItem({
    type,
    label,
    description,
    category,
    onAdd,
}: {
    readonly type: NodeType;
    readonly label: string;
    readonly description: string;
    readonly category: NodeCategory;
    readonly onAdd: (type: NodeType, label: string) => void;
}): ReactElement {
    const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData(NODE_DRAG_MIME, type);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <button
            type="button"
            draggable
            onDragStart={onDragStart}
            title={description}
            onClick={() => onAdd(type, label)}
            aria-label={`Add ${label} Node`}
            aria-describedby={`${type}-palette-description`}
            aria-keyshortcuts="Enter Space"
            className={cn(
                'group flex cursor-grab appearance-none flex-col gap-0.5 border border-veil/40 bg-obsidian-ink/60 px-3 py-2 text-left transition-colors hover:border-gilt/60',
                'active:cursor-grabbing',
            )}
        >
            <span
                className={cn(
                    'text-sm tracking-wide text-parchment group-hover:text-gilt',
                    CATEGORY_TEXT[category],
                )}
            >
                {label}
            </span>
            <span className="font-data text-[10px] text-veil-foreground">{type}</span>
            <span id={`${type}-palette-description`} className="sr-only">
                {description} Press Enter or Space to add this Node without dragging.
            </span>
        </button>
    );
}
