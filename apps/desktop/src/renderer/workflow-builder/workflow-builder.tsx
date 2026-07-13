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
import type {
    WorkflowDraftCommandDiagnostic,
    WorkflowDraftDiagnostic,
    WorkflowDraftSaveState,
} from './workflow-draft.js';

export interface WorkflowBuilderProps {
    readonly onSave: (name: string) => Promise<void>;
    readonly onCancel: () => void;
}

export function WorkflowBuilder({ onSave, onCancel }: WorkflowBuilderProps): ReactElement {
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const setPipelineName = useBuilderStore((state) => state.setPipelineName);
    const meta = useBuilderStore((state) => state.meta);
    const dirty = useBuilderStore((state) => state.dirty);
    const canUndo = useBuilderStore((state) => state.canUndo);
    const canRedo = useBuilderStore((state) => state.canRedo);
    const saveState = useBuilderStore((state) => state.saveState);
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
                    id="workflow-name"
                    type="text"
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    placeholder="Workflow name..."
                    aria-label="Workflow name"
                    className="font-ui flex-1 bg-transparent text-parchment outline-none placeholder:text-veil-foreground focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2"
                />
                <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label="Workflow save status"
                    className={saveStatusClass(saveState, dirty)}
                >
                    {saveStatusLabel(saveState, dirty)}
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
                    aria-expanded={showInspector}
                    className={`font-ui text-[10px] tracking-[0.2em] uppercase transition-colors ${
                        showInspector ? 'text-gilt' : 'text-veil-foreground hover:text-parchment'
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
                        <div
                            id="workflow-variable-inspector"
                            className="sigil-ornamental-frame relative mt-2 h-48 shrink-0 overflow-hidden"
                        >
                            <VariableInspector workflowId={meta.workflowId} />
                            <CornerFlourish corner="tl" />
                            <CornerFlourish corner="br" />
                        </div>
                    ) : null}
                    <ValidationBar onSave={onSave} saveState={saveState} />
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
    readonly onSave: (name: string) => Promise<void>;
    readonly saveState: WorkflowDraftSaveState;
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

type CommandDiagnostic = Extract<WorkflowDraftDiagnostic, WorkflowDraftCommandDiagnostic>;
type PersistenceDiagnostic = Extract<WorkflowDraftDiagnostic, { readonly kind: 'persistence' }>;

function isCommandDiagnostic(diagnostic: WorkflowDraftDiagnostic): diagnostic is CommandDiagnostic {
    return 'kind' in diagnostic && diagnostic.kind === 'command';
}

function isPersistenceDiagnostic(
    diagnostic: WorkflowDraftDiagnostic,
): diagnostic is PersistenceDiagnostic {
    return 'kind' in diagnostic && diagnostic.kind === 'persistence';
}

function isTopologyDiagnostic(
    diagnostic: WorkflowDraftDiagnostic,
): diagnostic is TopologyDiagnostic {
    return !('kind' in diagnostic);
}

function saveDiagnosticTargetLabel(diagnostic: WorkflowDraftDiagnostic): string {
    if (isCommandDiagnostic(diagnostic)) return `${diagnostic.operation} command`;
    if (isPersistenceDiagnostic(diagnostic)) return `Persistence ${diagnostic.phase}`;
    return diagnosticTargetLabel(diagnostic);
}

function saveDiagnosticContextLabel(diagnostic: WorkflowDraftDiagnostic): string | null {
    if (!isTopologyDiagnostic(diagnostic)) return null;
    return diagnostic.fieldPath ?? null;
}

function saveDiagnosticRepairHint(diagnostic: WorkflowDraftDiagnostic): string | null {
    if (isPersistenceDiagnostic(diagnostic)) return null;
    return diagnostic.repairHint ?? null;
}

function saveDiagnosticKey(diagnostic: WorkflowDraftDiagnostic): string {
    return `${diagnostic.code}-${saveDiagnosticTargetLabel(diagnostic)}-${
        saveDiagnosticContextLabel(diagnostic) ?? ''
    }-${diagnostic.message}`;
}

function saveStatusLabel(saveState: WorkflowDraftSaveState, dirty: boolean): string {
    switch (saveState.status) {
        case 'idle':
            return dirty ? 'Unsaved' : 'Saved';
        case 'pending':
            return 'Saving…';
        case 'success':
            return dirty ? 'Unsaved changes' : 'Saved';
        case 'failure':
            return 'Save failed';
        default:
            return assertNever(saveState);
    }
}

function saveStatusClass(saveState: WorkflowDraftSaveState, dirty: boolean): string {
    if (saveState.status === 'failure') return 'font-ui text-xs text-old-blood-foreground';
    if (saveState.status === 'pending') return 'font-ui text-xs text-gilt';
    return dirty ? 'font-ui text-xs text-gilt' : 'font-ui text-xs text-verdigris-foreground';
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow Builder state: ${JSON.stringify(value)}`);
}

function ValidationBar({ onSave, saveState }: ValidationBarProps): ReactElement {
    const nodes = useBuilderStore((state) => state.nodes);
    const edges = useBuilderStore((state) => state.edges);
    const meta = useBuilderStore((state) => state.meta);
    const pipelineName = useBuilderStore((state) => state.pipelineName);
    const dirty = useBuilderStore((state) => state.dirty);
    const validation = useBuilderStore((state) => state.validation);
    const result = useMemo(() => compileGraph(nodes, edges, meta), [nodes, edges, meta]);
    const diagnostics = validation.diagnostics;
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warningCount = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'warning',
    ).length;
    const [copied, setCopied] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const onExport = async (): Promise<void> => {
        if (!result.ok) return;
        setExportError(null);
        try {
            await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            setCopied(false);
            setExportError(
                `Could not copy the Workflow JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    };

    const handleSave = (): void => {
        void onSave(pipelineName);
    };

    const savePending = saveState.status === 'pending';
    const saveFailed = saveState.status === 'failure';

    return (
        <div className="border-gilt/40 flex items-center justify-between gap-4 border-t px-5 py-3">
            <div className="min-w-0 flex-1">
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
                                    : 'text-verdigris-foreground'
                                : 'text-old-blood-foreground',
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
                                            ? 'text-old-blood-foreground'
                                            : 'text-gilt'
                                    }
                                >
                                    {diagnostic.severity === 'error' ? 'Error' : 'Warning'}
                                </span>{' '}
                                <span className="text-parchment">
                                    {diagnosticTargetLabel(diagnostic)}
                                    {diagnostic.fieldPath ? ` · ${diagnostic.fieldPath}` : ''}
                                </span>{' '}
                                <span className="text-veil-foreground">{diagnostic.message}</span>
                                {diagnostic.repairHint ? (
                                    <span className="text-gilt">
                                        {' '}
                                        Repair: {diagnostic.repairHint}
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : null}
                {saveState.status === 'pending' ? (
                    <p className="text-gilt mt-1 font-data text-[10px]">Saving Workflow…</p>
                ) : null}
                {saveState.status === 'success' && !dirty ? (
                    <p className="text-verdigris-foreground mt-1 font-data text-[10px]">
                        Workflow saved successfully.
                    </p>
                ) : null}
                {saveState.status === 'failure' ? (
                    <div role="alert" className="mt-1">
                        <p className="text-old-blood-foreground break-words font-data text-[10px]">
                            {saveState.error}
                        </p>
                        {saveState.diagnostics.length > 0 ? (
                            <ul className="mt-1 space-y-1 pl-4 font-data text-[10px]">
                                {saveState.diagnostics.map((diagnostic) => (
                                    <li key={saveDiagnosticKey(diagnostic)} className="break-words">
                                        <span className="text-parchment">
                                            {saveDiagnosticTargetLabel(diagnostic)}
                                            {saveDiagnosticContextLabel(diagnostic)
                                                ? ` · ${saveDiagnosticContextLabel(diagnostic)}`
                                                : ''}
                                        </span>{' '}
                                        <span className="text-veil-foreground">
                                            {diagnostic.message}
                                        </span>
                                        {saveDiagnosticRepairHint(diagnostic) ? (
                                            <span className="text-gilt">
                                                {' '}
                                                Repair: {saveDiagnosticRepairHint(diagnostic)}
                                            </span>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
                {exportError ? (
                    <p
                        role="alert"
                        className="text-old-blood-foreground mt-1 break-words font-data text-[10px]"
                    >
                        {exportError}
                    </p>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {copied ? 'Workflow JSON copied to the clipboard.' : ''}
                </span>
                <Button
                    size="sm"
                    variant="default"
                    disabled={!result.ok || !pipelineName.trim() || savePending}
                    onClick={handleSave}
                >
                    {savePending ? 'Saving…' : saveFailed ? 'Retry Save' : 'Save'}
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
