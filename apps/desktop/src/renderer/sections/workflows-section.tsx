import type { TopologyDiagnostic } from '@sigil/schema/topology';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';

import type { PluginInfo } from '../../shared/plugin-info.js';
import { sigilGlyphState, workflowActivationLabel } from '../../shared/workflow.js';
import { SectionShell } from '../components/section-shell.js';
import { SigilFrame } from '../components/sigil-frame.js';
import { SigilGlyph } from '../components/sigil-glyph.js';
import { Button } from '../components/ui/button.js';
import { useSigil } from '../lib/use-sigil.js';
import { useAppStore } from '../store/app-store.js';
import { useBuilderStore } from '../workflow-builder/builder-store.js';
import {
    createBuilderEventCatalogFromManifests,
    EVENT_CATALOG,
} from '../workflow-builder/event-catalog.js';
import {
    createNodeCatalogFromManifests,
    DEFAULT_NODE_CATALOG,
} from '../workflow-builder/node-catalog.js';
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

export function WorkflowsSection(): ReactElement {
    const workflowView = useAppStore((state) => state.workflowView);
    const setWorkflowView = useAppStore((state) => state.setWorkflowView);
    const editingWorkflowId = useAppStore((state) => state.editingWorkflowId);
    const setEditingWorkflowId = useAppStore((state) => state.setEditingWorkflowId);
    const workflows = useAppStore((state) => state.workflows);
    const [loading, setLoading] = useState(false);
    const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
    const sigil = useSigil();

    const nodeCatalog = useMemo(
        () =>
            plugins.length === 0
                ? DEFAULT_NODE_CATALOG
                : createNodeCatalogFromManifests(plugins.map((plugin) => plugin.manifest)),
        [plugins],
    );
    const eventCatalog = useMemo(
        () =>
            plugins.length === 0
                ? EVENT_CATALOG
                : createBuilderEventCatalogFromManifests(plugins.map((plugin) => plugin.manifest)),
        [plugins],
    );

    useEffect(() => {
        return () => {
            setWorkflowView('list');
            setEditingWorkflowId(null);
        };
    }, [setWorkflowView, setEditingWorkflowId]);

    useEffect(() => {
        let active = true;
        void sigil
            .listPlugins()
            .then((next) => {
                if (active) setPlugins(next);
            })
            .catch(() => {
                if (active) setPlugins([]);
            });
        return () => {
            active = false;
        };
    }, [sigil]);

    const handleCreate = useCallback(() => {
        useBuilderStore.getState().setNodeCatalog(nodeCatalog);
        useBuilderStore.getState().clear();
        setEditingWorkflowId(null);
        setWorkflowView('builder');
    }, [nodeCatalog, setWorkflowView, setEditingWorkflowId]);

    const handleEdit = useCallback(
        async (id: string) => {
            setLoading(true);
            try {
                const result = await sigil.getWorkflow(id);
                if (result) {
                    useBuilderStore.getState().setNodeCatalog(nodeCatalog);
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
        [nodeCatalog, setWorkflowView, setEditingWorkflowId, sigil],
    );

    const handleSave = useCallback(
        async (name: string): Promise<void> => {
            const savePromise = useBuilderStore
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
            const saveState = useBuilderStore.getState().saveState;
            const attemptId = saveState.status === 'pending' ? saveState.attemptId : null;
            const outcome = await savePromise;
            const currentState = useBuilderStore.getState();
            if (
                !outcome.ok ||
                attemptId === null ||
                currentState.saveState.status !== 'success' ||
                currentState.saveState.attemptId !== attemptId ||
                currentState.dirty
            ) {
                return;
            }
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
        return (
            <WorkflowBuilder
                onSave={handleSave}
                onCancel={handleCancel}
                nodeCatalog={nodeCatalog}
                eventCatalog={eventCatalog}
            />
        );
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
                    <SigilFrame bodyClassName="divide-gilt/30 divide-y">
                        {workflows.map((workflow) => {
                            const hasError = workflow.diagnostics?.some(
                                (diagnostic) => diagnostic.severity === 'error',
                            );
                            return (
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
                                                className="shrink-0"
                                                title={
                                                    hasError
                                                        ? 'Needs repair'
                                                        : `${workflow.enabled ? 'Enabled intent' : 'Disabled'} · ${workflowActivationLabel(workflow.activation)}`
                                                }
                                            >
                                                <SigilGlyph
                                                    seed={workflow.id}
                                                    state={
                                                        hasError
                                                            ? 'error'
                                                            : sigilGlyphState(workflow.activation)
                                                    }
                                                    size={18}
                                                />
                                            </span>
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
                            );
                        })}
                    </SigilFrame>
                )}
            </div>
        </SectionShell>
    );
}
