import type { CSSProperties, ElementType, ReactElement, ReactNode } from 'react';

import { cn } from '../lib/utils.js';

type SigilFrameTag = 'aside' | 'div' | 'nav' | 'section';

interface SigilFrameProps {
    /** Semantic element to render as the outermost (and only real) DOM landmark. */
    readonly as?: SigilFrameTag;
    /** Layout classes for the outer box: width, shrink, explicit height, margin. */
    readonly className?: string;
    /** Classes for the innermost content box: internal flex/overflow/padding. */
    readonly bodyClassName?: string;
    /** Size in px of the top-corner cut. Defaults to the guidance's standard cut. */
    readonly chamfer?: number;
    readonly id?: string;
    readonly children: ReactNode;
}

interface Ring {
    readonly pad: number;
    readonly background: string;
}

// Nested ring widths mirror the old .sigil-ornamental-frame box-shadow steps:
// a 1px outer line, a 3px gap, a 1px inner line, then the panel's own fill.
const RINGS: readonly Ring[] = [
    { pad: 1, background: 'color-mix(in oklab, var(--color-gilt) 55%, transparent)' },
    { pad: 3, background: 'var(--color-obsidian-ink)' },
    { pad: 1, background: 'color-mix(in oklab, var(--color-gilt) 28%, transparent)' },
];

const CONTENT_BACKGROUND = 'var(--color-obsidian-ink)';

/** Chamfers only the top two corners — the panel stays grounded along its base. */
function chamferClip(cut: number): string {
    const c = Math.max(cut, 0);
    return `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% 100%, 0 100%, 0 ${c}px)`;
}

/**
 * The structural-panel frame from UI_STYLE_GUIDANCE.md: chamfered top
 * corners instead of a plain rectangle, traced by a nested gilt ring.
 * Corner ornament was dropped — corners are the part of a panel nobody
 * looks at, so the panel's own silhouette carries the ornament instead.
 */
export function SigilFrame({
    as = 'div',
    className,
    bodyClassName,
    chamfer = 18,
    id,
    children,
}: SigilFrameProps): ReactElement {
    const Tag = as as ElementType;

    let inset = 0;
    const ringStyles: CSSProperties[] = RINGS.map((ring) => {
        const style: CSSProperties = {
            clipPath: chamferClip(chamfer - inset),
            background: ring.background,
            padding: ring.pad,
        };
        inset += ring.pad;
        return style;
    });
    const contentStyle: CSSProperties = {
        clipPath: chamferClip(chamfer - inset),
        background: CONTENT_BACKGROUND,
    };

    const first = ringStyles[0];
    const second = ringStyles[1];
    const third = ringStyles[2];
    if (!first || !second || !third)
        throw new Error('SigilFrame: ring styles were not fully computed');

    return (
        <Tag id={id} className={cn('relative flex flex-col', className)} style={first}>
            <div className="flex min-h-0 flex-1 flex-col" style={second}>
                <div className="flex min-h-0 flex-1 flex-col" style={third}>
                    <div
                        className={cn('flex min-h-0 flex-1 flex-col', bodyClassName)}
                        style={contentStyle}
                    >
                        {children}
                    </div>
                </div>
            </div>
        </Tag>
    );
}
