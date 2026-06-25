import { type ReactElement, useCallback, useEffect, useState } from 'react';

import type { CompiledPipeline } from '@sigil/schema';

import { SectionShell } from '../components/section-shell.js';
import { Button } from '../components/ui/button.js';
import { useAppStore } from '../store/app-store.js';
import { useBuilderStore } from '../workflow-builder/builder-store.js';
import { WorkflowBuilder } from '../workflow-builder/workflow-builder.js';

export function WorkflowsSection(): ReactElement {
    const workflowView = useAppStore((state) => state.workflowView);
    const setWorkflowView = useAppStore((state) => state.setWorkflowView);
    const editingWorkflowId = useAppStore((state) => state.editingWorkflowId);
    const setEditingWorkflowId = useAppStore((state) => state.setEditingWorkflowId);
    const workflows = useAppStore((state) => state.workflows);
    const [loading, setLoading] = useState(false);

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
                const result = await window.sigil.getWorkflow(id);
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
        [setWorkflowView, setEditingWorkflowId],
    );

    const handleSave = useCallback(
        async (name: string) => {
            const result = useBuilderStore.getState().compile();
            if (!result.ok) return;
            const pipeline: CompiledPipeline = result.value;
            const positions = useBuilderStore.getState().getPositions();
            try {
                if (editingWorkflowId) {
                    await window.sigil.updateWorkflow(editingWorkflowId, name, pipeline, positions);
                } else {
                    await window.sigil.createWorkflow(name, pipeline, positions);
                }
                setWorkflowView('list');
                setEditingWorkflowId(null);
            } catch (err) {
                console.error('Failed to save workflow:', err);
            }
        },
        [editingWorkflowId, setWorkflowView, setEditingWorkflowId],
    );

    const handleCancel = useCallback(() => {
        setWorkflowView('list');
        setEditingWorkflowId(null);
    }, [setWorkflowView, setEditingWorkflowId]);

    const handleToggle = useCallback(async (id: string) => {
        try {
            await window.sigil.toggleWorkflow(id);
        } catch (err) {
            console.error('Failed to toggle workflow:', err);
        }
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        try {
            await window.sigil.deleteWorkflow(id);
        } catch (err) {
            console.error('Failed to delete workflow:', err);
        }
    }, []);

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
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <span className="font-ui text-parchment truncate text-sm">
                                        {workflow.name}
                                    </span>
                                    <span
                                        className={`inline-block h-2 w-2 shrink-0 ${
                                            workflow.enabled ? 'bg-verdigris' : 'bg-veil'
                                        }`}
                                        title={workflow.enabled ? 'Enabled' : 'Disabled'}
                                    />
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant={workflow.enabled ? 'default' : 'ghost'}
                                        onClick={() => handleToggle(workflow.id)}
                                    >
                                        {workflow.enabled ? 'Disable' : 'Enable'}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
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
