import type { ReactElement } from 'react';

import { isWorkflowActive } from '../../shared/workflow.js';
import { cn } from '../lib/utils.js';
import { useAppStore } from '../store/app-store.js';

export function WorkflowStatus(): ReactElement {
    const workflows = useAppStore((state) => state.workflows);
    const enabledCount = workflows.filter((w) => w.enabled).length;
    const activeCount = workflows.filter(isWorkflowActive).length;
    const failedCount = workflows.filter((w) => w.activation.kind === 'failed').length;
    const active = activeCount > 0;
    const statusColor = active ? 'text-gilt' : failedCount > 0 ? 'text-old-blood' : 'text-veil';

    return (
        <div className="border-gilt/40 border-t px-6 py-4">
            <div className="flex items-center gap-3">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className={cn(statusColor)}
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
                <span className={cn('font-ui text-xs tracking-widest uppercase', statusColor)}>
                    {active
                        ? `${activeCount} ${activeCount === 1 ? 'workflow' : 'workflows'} active`
                        : failedCount > 0
                          ? `${failedCount} ${failedCount === 1 ? 'workflow' : 'workflows'} failed to activate`
                          : enabledCount > 0
                            ? `${enabledCount} ${enabledCount === 1 ? 'workflow' : 'workflows'} activating`
                            : 'Workflows dormant'}
                </span>
            </div>
        </div>
    );
}
