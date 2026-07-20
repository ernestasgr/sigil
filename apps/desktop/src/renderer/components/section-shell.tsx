import type { ReactElement, ReactNode } from 'react';

import { SigilFrame } from './sigil-frame.js';

interface SectionShellProps {
    readonly title: string;
    readonly subtitle?: string;
    readonly children: ReactNode;
}

export function SectionShell({ title, subtitle, children }: SectionShellProps): ReactElement {
    return (
        <SigilFrame as="section" className="h-full">
            <header className="border-gilt/40 border-b px-8 py-6">
                <h1 className="font-display text-gilt text-2xl tracking-[0.3em] uppercase">
                    {title}
                </h1>
                {subtitle ? (
                    <p className="font-manuscript text-veil mt-2 text-base italic">{subtitle}</p>
                ) : null}
            </header>
            <div className="flex-1 overflow-auto p-8">{children}</div>
        </SigilFrame>
    );
}
