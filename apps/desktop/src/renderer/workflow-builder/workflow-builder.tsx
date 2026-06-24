import { ReactFlowProvider } from '@xyflow/react';
import { type ReactElement, useMemo, useState } from 'react';

import { Button } from '../components/ui/button.js';
import { cn } from '../lib/utils.js';
import { compileGraph } from './compile.js';
import { useBuilderStore } from './builder-store.js';
import { WorkflowCanvas } from './canvas/workflow-canvas.js';
import { NodePalette } from './palette/node-palette.js';
import { PropertiesPanel } from './inspector/properties-panel.js';

export function WorkflowBuilder(): ReactElement {
    return (
        <div className="flex h-full gap-2 bg-obsidian-ink p-2">
            <aside className="sigil-ornamental-frame w-60 shrink-0 overflow-hidden">
                <NodePalette />
            </aside>
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden">
                    <ReactFlowProvider>
                        <WorkflowCanvas />
                    </ReactFlowProvider>
                </div>
                <ValidationBar />
            </div>
            <aside className="sigil-ornamental-frame w-80 shrink-0 overflow-hidden">
                <PropertiesPanel />
            </aside>
        </div>
    );
}

function ValidationBar(): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const meta = useBuilderStore((state) => state.meta);
    const result = useMemo(() => compileGraph(nodes, edges, meta), [nodes, edges, meta]);
    const [copied, setCopied] = useState(false);

    const onExport = async () => {
        if (!result.ok) return;
        await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="border-gilt/40 flex items-center justify-between gap-4 border-t px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
                <span
                    className={cn(
                        'inline-block h-2 w-2 shrink-0',
                        result.ok ? 'bg-verdigris' : 'bg-old-blood',
                    )}
                />
                {result.ok ? (
                    <span className="font-ui text-xs text-veil">
                        Valid — {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'},{' '}
                        {edges.length} {edges.length === 1 ? 'edge' : 'edges'}
                    </span>
                ) : (
                    <pre className="text-old-blood max-h-16 overflow-auto whitespace-pre-wrap font-data text-xs">
                        {result.error}
                    </pre>
                )}
            </div>
            <Button
                size="sm"
                variant={result.ok ? 'default' : 'ghost'}
                disabled={!result.ok}
                onClick={onExport}
            >
                {copied ? 'Copied' : 'Export JSON'}
            </Button>
        </div>
    );
}
