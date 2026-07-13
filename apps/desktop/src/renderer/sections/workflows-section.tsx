import type { TopologyDiagnostic } from '@sigil/schema/topology';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import { type WorkflowSummary, workflowActivationLabel } from '../../shared/workflow.js';
import { SectionShell } from '../components/section-shell.js';
import { Button } from '../components/ui/button.js';
import { useSigil } from '../lib/use-sigil.js';
import { useAppStore } from '../store/app-store.js';
import { useBuilderStore } from '../workflow-builder/builder-store.js';
import { WorkflowBuilder } from '../workflow-builder/workflow-builder.js';
import type { WorkflowDraftSaveResult } from '../workflow-builder/workflow-draft.js';

function diagnosticTargetLabel(diagnostic: TopologyDiagnostic): string {
    switch (diagnostic.target.kind) {
        case 'pipeline':
            return 'Workflow';
        case 'node':
            return `Node ${diagnostic.target.nodeId}`;
        case 'edge':
            return `Edge ${diagnostic.target.edgeId}`;
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow activation state: ${JSON.stringify(value)}`);
}

function activationIndicatorClass(workflow: WorkflowSummary): string {
    switch (workflow.activation.kind) {
        case 'disabled':
            return 'bg-veil';
        case 'activating':
            return 'bg-gilt';
        case 'active':
            return 'bg-verdigris';
        case 'failed':
            return 'bg-old-blood';
        default:
            return assertNever(workflow.activation);
    }
}

export function WorkflowsSection(): ReactElement {
    const workflowView = useAppStore((state) => state.workflowView);
    const setWorkflowView = useAppStore((state) => state.setWorkflowView);
    const editingWorkflowId = useAppStore((state) => state.editingWorkflowId);
    const setEditingWorkflowId = useAppStore((state) => state.setEditingWorkflowId);
    const workflows = useAppStore((state) => state.workflows);
    const [loading, setLoading] = useState(false);
    const sigil = useSigil();

    useEffect(() => {
        return () => {
            setWorkflowView('list');
            setEditingWorkflowId(null);
        };
    }, [setWorkflowView, setEditingWorkflowId]);

    const handleCreate = useCallback(() => {
        useBuilderStore.getState().clear();
        setEditingWorkflowId(null);
        setWorkflowView('builder');
    }, [setWorkflowView, setEditingWorkflowId]);

    const handleEdit = useCallback(
        async (id: string) => {
            setLoading(true);
            try {
                const result = await sigil.getWorkflow(id);
                if (result) {
                    useBuilderStore
                        .getState()
                        .loadPipeline(result.pipeline, result.name, result.positions);
                    setEditingWorkflowId(id);
                    setWorkflowView('builder');
                }
            } catch (err) {
                console.error('Failed to load workflow:', err);
            } finally {
                setLoading(false);
            }
        },
        [setWorkflowView, setEditingWorkflowId, sigil],
    );

    const handleSave = useCallback(
        async (name: string): Promise<void> => {
            const outcome = await useBuilderStore
                .getState()
                .save(
                    name,
                    async ({
                        name: saveName,
                        pipeline,
                        positions,
                    }): Promise<WorkflowDraftSaveResult> => {
                        const writeOutcome = editingWorkflowId
                            ? await sigil.updateWorkflow(
                                  editingWorkflowId,
                                  saveName,
                                  pipeline,
                                  positions,
                              )
                            : await sigil.createWorkflow(saveName, pipeline, positions);
                        if (writeOutcome.ok) return { ok: true };
                        return {
                            ok: false,
                            error: writeOutcome.error,
                            diagnostics: writeOutcome.diagnostics,
                        };
                    },
                );
            if (!outcome.ok) return;
            setWorkflowView('list');
            setEditingWorkflowId(null);
        },
        [editingWorkflowId, setWorkflowView, setEditingWorkflowId, sigil],
    );

    const handleCancel = useCallback(() => {
        setWorkflowView('list');
        setEditingWorkflowId(null);
    }, [setWorkflowView, setEditingWorkflowId]);

    const handleToggle = useCallback(
        async (id: string) => {
            try {
                const outcome = await sigil.toggleWorkflow(id);
                if (!outcome.ok) {
                    console.error('Failed to toggle workflow:', outcome.error, outcome.diagnostics);
                }
            } catch (err) {
                console.error('Failed to toggle workflow:', err);
            }
        },
        [sigil],
    );

    const handleRetry = useCallback(
        async (id: string) => {
            try {
                const outcome = await sigil.retryWorkflow(id);
                if (!outcome.ok) {
                    console.error('Failed to retry workflow:', outcome.error, outcome.diagnostics);
                }
            } catch (err) {
                console.error('Failed to retry workflow:', err);
            }
        },
        [sigil],
    );

    const handleDelete = useCallback(
        async (id: string) => {
            try {
                const outcome = await sigil.deleteWorkflow(id);
                if (!outcome.ok) {
                    console.error('Failed to delete workflow:', outcome.error, outcome.diagnostics);
                }
            } catch (err) {
                console.error('Failed to delete workflow:', err);
            }
        },
        [sigil],
    );

    if (workflowView === 'builder') {
        return <WorkflowBuilder onSave={handleSave} onCancel={handleCancel} />;
    }

    return (
        <SectionShell title="Workflows" subtitle="Manage your automations.">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <span className="font-ui text-xs text-veil tracking-widest uppercase">
                        {workflows.length} {workflows.length === 1 ? 'workflow' : 'workflows'}
                    </span>
                    <Button size="sm" onClick={handleCreate}>
                        + Create
                    </Button>
                </div>

                {loading && (
                    <p className="font-manuscript text-veil px-4 py-8 text-center text-sm italic">
                        Loading workflow...
                    </p>
                )}

                {!loading && workflows.length === 0 && (
                    <p className="font-manuscript text-veil px-4 py-8 text-center text-sm italic">
                        No workflows yet. Create one to get started.
                    </p>
                )}

                {!loading && workflows.length > 0 && (
                    <div className="divide-gilt/30 border-gilt/40 divide-y border">
                        {workflows.map((workflow) => (
                            <div
                                key={workflow.id}
                                className="flex items-center justify-between px-4 py-3"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="font-ui text-parchment truncate text-sm">
                                            {workflow.name}
                                        </span>
                                        <span
                                            className={`inline-block h-2 w-2 shrink-0 ${
                                                workflow.diagnostics?.some(
                                                    (diagnostic) => diagnostic.severity === 'error',
                                                )
                                                    ? 'bg-old-blood'
                                                    : activationIndicatorClass(workflow)
                                            }`}
                                            title={
                                                workflow.diagnostics?.some(
                                                    (diagnostic) => diagnostic.severity === 'error',
                                                )
                                                    ? 'Needs repair'
                                                    : `${workflow.enabled ? 'Enabled intent' : 'Disabled'} · ${workflowActivationLabel(workflow.activation)}`
                                            }
                                        />
                                    </div>
                                    {workflow.diagnostics?.length ? (
                                        <div className="mt-1 space-y-1 pr-4 font-data text-[10px]">
                                            {workflow.diagnostics.map((diagnostic) => (
                                                <p
                                                    key={`${diagnostic.severity}-${diagnostic.code}-${diagnostic.target.kind}-${diagnostic.message}`}
                                                    className={
                                                        diagnostic.severity === 'error'
                                                            ? 'text-old-blood'
                                                            : 'text-gilt'
                                                    }
                                                >
                                                    <span className="text-parchment">
                                                        {diagnosticTargetLabel(diagnostic)}
                                                    </span>{' '}
                                                    {diagnostic.message}
                                                </p>
                                            ))}
                                        </div>
                                    ) : null}
                                    {workflow.activation.kind === 'failed' ? (
                                        <p className="text-old-blood mt-1 pr-4 font-data text-[10px]">
                                            {workflow.activation.message}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant={workflow.enabled ? 'default' : 'ghost'}
                                        disabled={workflow.diagnostics?.some(
                                            (diagnostic) => diagnostic.severity === 'error',
                                        )}
                                        onClick={() => handleToggle(workflow.id)}
                                    >
                                        {workflow.enabled ? 'Disable' : 'Enable'}
                                    </Button>
                                    {workflow.activation.kind === 'failed' ? (
                                        <Button
                                            size="sm"
                                            disabled={workflow.diagnostics?.some(
                                                (diagnostic) => diagnostic.severity === 'error',
                                            )}
                                            onClick={() => handleRetry(workflow.id)}
                                        >
                                            Retry
                                        </Button>
                                    ) : null}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={workflow.diagnostics?.some(
                                            (diagnostic) => diagnostic.severity === 'error',
                                        )}
                                        onClick={() => handleEdit(workflow.id)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => handleDelete(workflow.id)}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </SectionShell>
    );
}
