import type { TopologyDiagnostic } from '@sigil/schema/topology';
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
    readonly saveError?: string | null;
}

export function WorkflowBuilder({
    onSave,
    onCancel,
    saveError = null,
}: WorkflowBuilderProps): ReactElement {
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const setPipelineName = useBuilderStore((state) => state.setPipelineName);
    const meta = useBuilderStore((state) => state.meta);
    const dirty = useBuilderStore((state) => state.dirty);
    const canUndo = useBuilderStore((state) => state.canUndo);
    const canRedo = useBuilderStore((state) => state.canRedo);
    const undo = useBuilderStore((state) => state.undo);
    const redo = useBuilderStore((state) => state.redo);
    const [showInspector, setShowInspector] = useState(false);

    const handleCancel = () => {
        if (dirty && !window.confirm('Discard unsaved Workflow changes?')) return;
        onCancel();
    };

    return (
        <div className="flex h-full flex-col bg-obsidian-ink p-2">
            <div className="border-gilt/40 mb-2 flex items-center gap-3 border px-4 py-2">
                <Button size="sm" variant="ghost" onClick={handleCancel}>
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
                <span
                    role="status"
                    aria-live="polite"
                    className={
                        dirty ? 'font-ui text-xs text-gilt' : 'font-ui text-xs text-verdigris'
                    }
                >
                    {dirty ? 'Unsaved' : 'Saved'}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canUndo}
                    onClick={undo}
                    aria-label="Undo last Workflow edit"
                    title="Undo last edit"
                >
                    Undo
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canRedo}
                    onClick={redo}
                    aria-label="Redo last Workflow edit"
                    title="Redo last edit"
                >
                    Redo
                </Button>
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
                    <ValidationBar onSave={onSave} saveError={saveError} />
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
    readonly saveError: string | null;
}

function diagnosticTargetLabel(diagnostic: TopologyDiagnostic): string {
    switch (diagnostic.target.kind) {
        case 'pipeline':
            return 'Workflow';
        case 'node':
            return `Node ${diagnostic.target.nodeId}`;
        case 'edge':
            return diagnostic.nodeId
                ? `Edge ${diagnostic.target.edgeId} · Node ${diagnostic.nodeId}`
                : `Edge ${diagnostic.target.edgeId}`;
    }
}

function ValidationBar({ onSave, saveError }: ValidationBarProps): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const meta = useBuilderStore((state) => state.meta);
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const result = useMemo(() => compileGraph(nodes, edges, meta), [nodes, edges, meta]);
    const diagnostics = result.diagnostics;
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warningCount = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'warning',
    ).length;
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
            <div className="min-w-0 flex-1" role="status" aria-live="polite">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'inline-block h-2 w-2 shrink-0',
                            result.ok
                                ? warningCount > 0
                                    ? 'bg-gilt'
                                    : 'bg-verdigris'
                                : 'bg-old-blood',
                        )}
                    />
                    <span
                        className={cn(
                            'font-ui text-xs',
                            result.ok
                                ? warningCount > 0
                                    ? 'text-gilt'
                                    : 'text-verdigris'
                                : 'text-old-blood',
                        )}
                    >
                        {result.ok
                            ? warningCount > 0
                                ? `Ready with ${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
                                : `Valid — ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'}, ${edges.length} ${edges.length === 1 ? 'edge' : 'edges'}`
                            : `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}${warningCount > 0 ? ` · ${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}` : ''}`}
                    </span>
                </div>
                {diagnostics.length > 0 ? (
                    <ul className="mt-1 max-h-20 space-y-1 overflow-auto pl-4 font-data text-[10px]">
                        {diagnostics.map((diagnostic) => (
                            <li
                                key={`${diagnostic.severity}-${diagnostic.code}-${diagnostic.target.kind}-${diagnostic.message}`}
                                className="break-words"
                            >
                                <span
                                    className={
                                        diagnostic.severity === 'error'
                                            ? 'text-old-blood'
                                            : 'text-gilt'
                                    }
                                >
                                    {diagnostic.severity === 'error' ? 'Error' : 'Warning'}
                                </span>{' '}
                                <span className="text-parchment">
                                    {diagnosticTargetLabel(diagnostic)}
                                </span>{' '}
                                <span className="text-veil">{diagnostic.message}</span>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {saveError ? (
                    <p
                        role="alert"
                        className="text-old-blood mt-1 break-words font-data text-[10px]"
                    >
                        {saveError}
                    </p>
                ) : null}
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
