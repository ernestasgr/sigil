import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';

export function WorkflowsSection(): ReactElement {
    return (
        <SectionShell title="Workflows" subtitle="Compose sigils on the ritual grid.">
            <div className="border-gilt/40 min-h-120 h-full border">
                <ReactFlow />
            </div>
        </SectionShell>
    );
}
