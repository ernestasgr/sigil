import type { ReactElement, ReactNode } from 'react';

interface PanelHeadingProps {
    readonly children: ReactNode;
}

/**
 * A panel title over a doubled rule broken by a single diamond keystone —
 * the ornament lives where the eye actually goes, not in an unread corner.
 * See UI_STYLE_GUIDANCE.md.
 */
export function PanelHeading({ children }: PanelHeadingProps): ReactElement {
    return (
        <div className="px-4 pt-3">
            <h2 className="font-ui text-veil text-xs tracking-widest uppercase">{children}</h2>
            <div className="relative mt-3 h-2">
                <div className="bg-gilt/70 absolute inset-x-0 top-0 h-[1.5px]" />
                <div className="bg-gilt/30 absolute inset-x-0 top-[5px] h-px" />
                <div className="bg-obsidian-ink border-gilt absolute top-[-3px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-[1.5px]" />
            </div>
        </div>
    );
}
