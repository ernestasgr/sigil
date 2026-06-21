import type { ReactElement } from 'react';

import { cn } from '../lib/utils.js';
import { useAppStore } from '../store/app-store.js';

export function WorkflowStatus(): ReactElement {
    const workflowsActive = useAppStore((state) => state.workflowsActive);

    return (
        <div className="border-gilt/40 border-t px-6 py-4">
            <div className="flex items-center gap-3">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className={cn(workflowsActive ? 'text-gilt' : 'text-veil')}
                    aria-hidden="true"
                >
                    <polygon
                        points="7,1 13,7 7,13 1,7"
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                    />
                    <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span
                    className={cn(
                        'font-ui text-xs tracking-widest uppercase',
                        workflowsActive ? 'text-gilt' : 'text-veil',
                    )}
                >
                    {workflowsActive ? 'Workflows active' : 'Workflows dormant'}
                </span>
            </div>
        </div>
    );
}
