import { ReactFlowProvider } from '@xyflow/react';
import { type ReactElement, useMemo, useState } from 'react';

import { Button } from '../components/ui/button.js';
import { cn } from '../lib/utils.js';
import { useBuilderStore } from './builder-store.js';
import { WorkflowCanvas } from './canvas/workflow-canvas.js';
import { compileGraph } from './compile.js';
import { CornerFlourish } from './corner-flourish.js';
import { PropertiesPanel } from './inspector/properties-panel.js';
import { VariableInspector } from './inspector/variable-inspector.js';
import { NodePalette } from './palette/node-palette.js';

export interface WorkflowBuilderProps {
    readonly onSave: (name: string) => void;
    readonly onCancel: () => void;
}

export function WorkflowBuilder({ onSave, onCancel }: WorkflowBuilderProps): ReactElement {
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const setPipelineName = useBuilderStore((state) => state.setPipelineName);
    const meta = useBuilderStore((state) => state.meta);
    const [showInspector, setShowInspector] = useState(false);

    return (
        <div className="flex h-full flex-col bg-obsidian-ink p-2">
            <div className="border-gilt/40 mb-2 flex items-center gap-3 border px-4 py-2">
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    ← Back
                </Button>
                <input
                    type="text"
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    placeholder="Workflow name..."
                    aria-label="Workflow name"
                    className="font-ui flex-1 bg-transparent text-parchment outline-none placeholder:text-veil"
                />
                <button
                    type="button"
                    onClick={() => setShowInspector((prev) => !prev)}
                    className={`font-ui text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        showInspector ? 'text-gilt' : 'text-veil hover:text-parchment'
                    }`}
                >
                    {showInspector ? 'Hide Inspector' : 'Inspector'}
                </button>
            </div>
            <div className="flex flex-1 gap-2 overflow-hidden">
                <aside className="sigil-ornamental-frame relative w-60 shrink-0 overflow-hidden">
                    <NodePalette />
                    <CornerFlourish corner="tl" />
                    <CornerFlourish corner="br" />
                </aside>
                <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                        <ReactFlowProvider>
                            <WorkflowCanvas />
                        </ReactFlowProvider>
                    </div>
                    {showInspector ? (
                        <div className="sigil-ornamental-frame relative mt-2 h-48 shrink-0 overflow-hidden">
                            <VariableInspector workflowId={meta.workflowId} />
                            <CornerFlourish corner="tl" />
                            <CornerFlourish corner="br" />
                        </div>
                    ) : null}
                    <ValidationBar onSave={onSave} />
                </div>
                <aside className="sigil-ornamental-frame relative w-80 shrink-0 overflow-hidden">
                    <PropertiesPanel />
                    <CornerFlourish corner="tl" />
                    <CornerFlourish corner="br" />
                </aside>
            </div>
        </div>
    );
}

interface ValidationBarProps {
    readonly onSave: (name: string) => void;
}

function ValidationBar({ onSave }: ValidationBarProps): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const meta = useBuilderStore((state) => state.meta);
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const result = useMemo(() => compileGraph(nodes, edges, meta), [nodes, edges, meta]);
    const [copied, setCopied] = useState(false);

    const onExport = async () => {
        if (!result.ok) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard write failed — don't show copied state
        }
    };

    const handleSave = () => {
        onSave(pipelineName);
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
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="default"
                    disabled={!result.ok || !pipelineName.trim()}
                    onClick={handleSave}
                >
                    Save
                </Button>
                <Button
                    size="sm"
                    variant={result.ok ? 'default' : 'ghost'}
                    disabled={!result.ok}
                    onClick={onExport}
                >
                    {copied ? 'Copied' : 'Export JSON'}
                </Button>
            </div>
        </div>
    );
}
