import type { ReactElement } from 'react';
import { cn } from '../lib/utils.js';
import { SECTIONS } from '../sections.js';
import { type Section, useAppStore } from '../store/app-store.js';
import { useBuilderStore } from '../workflow-builder/builder-store.js';
import { SigilFrame } from './sigil-frame.js';
import { WorkflowStatus } from './workflow-status.js';

export function Nav(): ReactElement {
    const activeSection = useAppStore((state) => state.activeSection);
    const workflowView = useAppStore((state) => state.workflowView);
    const navigate = useAppStore((state) => state.navigate);
    const dirty = useBuilderStore((state) => state.dirty);

    const handleNavigate = (section: Section): void => {
        const leavingBuilder =
            activeSection === 'workflows' && workflowView === 'builder' && section !== 'workflows';
        if (leavingBuilder && dirty && !window.confirm('Discard unsaved Workflow changes?')) return;
        navigate(section);
    };

    return (
        <SigilFrame as="nav" className="w-60 shrink-0">
            <div className="border-gilt/40 border-b px-6 py-6">
                <h1 className="font-display text-gilt text-xl tracking-[0.3em] uppercase">Sigil</h1>
            </div>
            <ul className="flex-1 py-4">
                {SECTIONS.map((section) => (
                    <li key={section.id}>
                        <button
                            type="button"
                            onClick={() => handleNavigate(section.id)}
                            className={cn(
                                'border-l-2 font-ui text-sm tracking-widest uppercase transition-colors w-full px-6 py-3 text-left',
                                activeSection === section.id
                                    ? 'border-gilt text-gilt bg-gilt/10'
                                    : 'border-transparent text-veil hover:text-parchment',
                            )}
                        >
                            {section.label}
                        </button>
                    </li>
                ))}
            </ul>
            <WorkflowStatus />
        </SigilFrame>
    );
}
