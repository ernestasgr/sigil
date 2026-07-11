import type { NodeType } from '@sigil/schema/nodes';
import type { DragEvent, ReactElement } from 'react';

import { cn } from '../../lib/utils.js';
import { NODE_DRAG_MIME } from '../constants.js';
import { CATEGORIES, CATEGORY_TEXT, NODE_TYPES, type NodeCategory } from '../node-registry.js';

export function NodePalette(): ReactElement {
    return (
        <div className="flex h-full flex-col gap-5 overflow-auto p-4">
            <h2 className="font-display text-gilt text-xs tracking-[0.3em] uppercase">
                Node Library
            </h2>
            {CATEGORIES.map((category) => (
                <PaletteCategory key={category.id} category={category.id} label={category.label} />
            ))}
        </div>
    );
}

function PaletteCategory({
    category,
    label,
}: {
    readonly category: NodeCategory;
    readonly label: string;
}): ReactElement {
    const items = NODE_TYPES.filter((def) => def.category === category);
    return (
        <section className="flex flex-col gap-2">
            <h3 className="font-ui text-[10px] tracking-widest text-veil uppercase">{label}</h3>
            <div className="flex flex-col gap-1.5">
                {items.map((def) => (
                    <PaletteItem
                        key={def.type}
                        type={def.type}
                        label={def.label}
                        description={def.description}
                        category={def.category}
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
}: {
    readonly type: NodeType;
    readonly label: string;
    readonly description: string;
    readonly category: NodeCategory;
}): ReactElement {
    const onDragStart = (event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(NODE_DRAG_MIME, type);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            title={description}
            tabIndex={0}
            role="option"
            aria-roledescription="Draggable node"
            className={cn(
                'group flex cursor-grab flex-col gap-0.5 border border-veil/40 bg-obsidian-ink/60 px-3 py-2 transition-colors hover:border-gilt/60',
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
            <span className="font-data text-[10px] text-veil">{type}</span>
        </div>
    );
}
