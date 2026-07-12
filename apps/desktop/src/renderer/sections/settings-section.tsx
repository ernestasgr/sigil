import type { Capability } from '@sigil/schema/manifest';
import { CapabilitySchema } from '@sigil/schema/manifest';

import { DEFAULT_PROPERTIES as ENGINE_DEFAULTS } from '@sigil/schema/properties-file';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { WorkflowStateEntry } from '../../shared/ipc-channels.js';
import type { PluginInfo } from '../../shared/plugin-info.js';
import { type WorkflowSummary, workflowActivationLabel } from '../../shared/workflow.js';
import { SectionShell } from '../components/section-shell.js';
import { Button } from '../components/ui/button.js';
import { useSigil } from '../lib/use-sigil.js';
import { useAppStore } from '../store/app-store.js';

const ALL_CAPABILITIES = CapabilitySchema.options;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function persistenceErrorMessage(
    error: string,
    diagnostic: { readonly phase: string; readonly path: string },
): string {
    return `${error} [${diagnostic.phase}] ${diagnostic.path}`;
}

function capabilityLabel(cap: Capability): string {
    return cap
        .split('.')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
}

function PermissionToggle({
    capability,
    granted,
    onToggle,
}: {
    readonly capability: Capability;
    readonly granted: boolean;
    readonly onToggle: () => void;
}): ReactElement {
    return (
        <label className="flex cursor-pointer items-center gap-3">
            <input
                type="checkbox"
                checked={granted}
                onChange={onToggle}
                className="border-gilt/60 size-4 cursor-pointer appearance-none border bg-transparent checked:bg-gilt checked:hover:bg-gilt/80 focus-visible:ring-gilt focus-visible:ring-2 focus-visible:outline-none"
            />
            <span className="font-ui text-parchment text-xs tracking-wider uppercase">
                {capabilityLabel(capability)}
            </span>
        </label>
    );
}

function PluginPermissionsCard({
    info,
    onOverride,
}: {
    readonly info: PluginInfo;
    readonly onOverride: (pluginId: string, overrides: readonly Capability[]) => void;
}): ReactElement {
    const [editing, setEditing] = useState(false);
    const [selected, setSelected] = useState<readonly Capability[]>(info.grantedPermissions);

    const hasOverride =
        info.grantedPermissions.length !== info.manifest.permissions.length ||
        !info.manifest.permissions.every((p) => info.grantedPermissions.includes(p));

    const handleToggle = (cap: Capability): void => {
        setSelected((prev) =>
            prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
        );
    };

    const handleSave = (): void => {
        onOverride(info.manifest.id, selected);
        setEditing(false);
    };

    return (
        <div className="border-gilt/30 border p-6">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="font-ui text-gilt text-lg tracking-wider uppercase">
                        {info.manifest.id}
                    </h3>
                    <p className="font-data text-veil mt-1 text-xs">v{info.manifest.version}</p>
                </div>
                {hasOverride && !editing ? (
                    <span className="font-data text-verdigris border-verdigris/60 border px-2 py-0.5 text-[10px] tracking-wider uppercase">
                        Overridden
                    </span>
                ) : null}
            </div>

            <div className="mt-4">
                <h4 className="font-ui text-veil mb-2 text-xs tracking-widest uppercase">
                    Manifest Requests
                </h4>
                <div className="flex flex-wrap gap-2">
                    {info.manifest.permissions.length === 0 ? (
                        <span className="font-manuscript text-veil text-xs italic">None</span>
                    ) : (
                        info.manifest.permissions.map((perm) => (
                            <span
                                key={perm}
                                className="font-data border-gilt/40 text-gilt border px-2 py-0.5 text-[10px] tracking-wider uppercase"
                            >
                                {perm}
                            </span>
                        ))
                    )}
                </div>
            </div>

            <div className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                    <h4 className="font-ui text-veil text-xs tracking-widest uppercase">
                        Granted Permissions
                    </h4>
                    <button
                        type="button"
                        onClick={() => {
                            if (editing) {
                                setSelected(info.grantedPermissions);
                                setEditing(false);
                            } else {
                                setSelected(info.grantedPermissions);
                                setEditing(true);
                            }
                        }}
                        className="font-ui text-gilt hover:text-gilt/80 text-[10px] tracking-widest uppercase transition-colors"
                    >
                        {editing ? 'Cancel' : 'Override'}
                    </button>
                </div>

                {editing ? (
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-2">
                            {ALL_CAPABILITIES.map((cap) => (
                                <PermissionToggle
                                    key={cap}
                                    capability={cap}
                                    granted={selected.includes(cap)}
                                    onToggle={() => handleToggle(cap)}
                                />
                            ))}
                        </div>
                        <div>
                            <Button
                                variant="default"
                                size="sm"
                                onClick={handleSave}
                                disabled={
                                    selected.length === 0 && info.grantedPermissions.length === 0
                                }
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {info.grantedPermissions.length === 0 ? (
                            <span className="font-manuscript text-old-blood text-xs italic">
                                None granted
                            </span>
                        ) : (
                            info.grantedPermissions.map((perm) => (
                                <span
                                    key={perm}
                                    className="font-data border-veil/60 text-parchment border px-2 py-0.5 text-[10px] tracking-wider uppercase"
                                >
                                    {perm}
                                </span>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const DEFAULT_PROPERTIES_TEMPLATE: Record<string, unknown> = {
    notifyOnWorkflowError: ENGINE_DEFAULTS.notifyOnWorkflowError,
    databasePath: ENGINE_DEFAULTS.databasePath,
    collisionSuffixStyle: ENGINE_DEFAULTS.collisionSuffixStyle,
    'file-watcher.ignorePatterns': ['*.crdownload', '*.part', '*.tmp', '*.download'],
    'file-manager.defaultOnConflict': 'error',
    'file-manager.collisionSuffixStyle': ENGINE_DEFAULTS.collisionSuffixStyle,
};

function PropertiesEditor({
    properties,
    onSave,
    onCancel,
}: {
    readonly properties: Record<string, unknown>;
    readonly onSave: (props: Record<string, unknown>) => void;
    readonly onCancel: () => void;
}): ReactElement {
    const [jsonText, setJsonText] = useState(() => {
        if (Object.keys(properties).length === 0) {
            return JSON.stringify(DEFAULT_PROPERTIES_TEMPLATE, null, 4);
        }
        return JSON.stringify(properties, null, 4);
    });
    const [error, setError] = useState<string | null>(null);
    const isFirstLoad = useRef(true);

    useEffect(() => {
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            return;
        }
        if (Object.keys(properties).length === 0) {
            setJsonText(JSON.stringify(DEFAULT_PROPERTIES_TEMPLATE, null, 4));
        } else {
            setJsonText(JSON.stringify(properties, null, 4));
        }
        setError(null);
    }, [properties]);

    const handleSave = (): void => {
        try {
            const parsed: unknown = JSON.parse(jsonText);
            if (!isRecord(parsed)) {
                setError('Root value must be a JSON object');
                return;
            }
            setError(null);
            onSave(parsed);
        } catch {
            setError('Invalid JSON');
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <h4 className="font-ui text-veil text-xs tracking-widest uppercase">
                sigil.properties.json
            </h4>
            <textarea
                value={jsonText}
                onChange={(e) => {
                    setJsonText(e.target.value);
                    setError(null);
                }}
                className="font-data bg-obsidian-ink border-gilt/30 text-parchment h-64 w-full resize-y border p-4 text-xs leading-relaxed focus:outline-none"
                spellCheck={false}
            />
            {error ? <p className="font-ui text-old-blood text-xs">{error}</p> : null}
            <div className="flex gap-3">
                <Button variant="default" size="sm" onClick={handleSave}>
                    Save
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function PermissionsPanel({
    plugins,
    loading,
    onOverride,
}: {
    readonly plugins: readonly PluginInfo[];
    readonly loading: boolean;
    readonly onOverride: (pluginId: string, overrides: readonly Capability[]) => void;
}): ReactElement {
    return (
        <div>
            <h2 className="font-display text-gilt mb-4 text-xl tracking-[0.25em] uppercase">
                Plugin Permissions
            </h2>
            <p className="font-manuscript text-veil mb-6 text-sm italic">
                Grant or revoke plugin permissions from the UI, overriding what the Manifest
                requests. Revoking a permission causes the plugin&apos;s next privileged call to
                fail gracefully.
            </p>
            {loading ? (
                <p className="font-manuscript text-veil italic">Loading plugins...</p>
            ) : plugins.length === 0 ? (
                <p className="font-manuscript text-veil italic">No plugins installed.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {plugins.map((plugin) => (
                        <PluginPermissionsCard
                            key={plugin.manifest.id}
                            info={plugin}
                            onOverride={onOverride}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function PropertiesFilePanel({
    onSave,
    onCancel,
    properties,
}: {
    readonly properties: Record<string, unknown>;
    readonly onSave: (props: Record<string, unknown>) => void;
    readonly onCancel: () => void;
}): ReactElement {
    return (
        <div>
            <h2 className="font-display text-gilt mb-4 text-xl tracking-[0.25em] uppercase">
                Properties File
            </h2>
            <p className="font-manuscript text-veil mb-6 text-sm italic">
                Engine settings and plugin defaults. Edits persist to{' '}
                <code className="font-data text-gilt">sigil.properties.json</code> and are picked up
                by the Engine&apos;s resolution order.
            </p>
            <PropertiesEditor properties={properties} onSave={onSave} onCancel={onCancel} />
        </div>
    );
}

function WorkflowStateCard({
    workflow,
    entries,
    onRefresh,
    onSetKey,
    onDeleteKey,
}: {
    readonly workflow: WorkflowSummary;
    readonly entries: readonly WorkflowStateEntry[];
    readonly onRefresh: () => void;
    readonly onSetKey: (key: string, value: string) => void;
    readonly onDeleteKey: (key: string) => void;
}): ReactElement {
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    return (
        <div className="border-gilt/30 border p-6">
            <div className="flex items-center justify-between">
                <h3 className="font-ui text-gilt text-lg tracking-wider uppercase">
                    {workflow.name}
                </h3>
                <span
                    className={`font-data text-xs tracking-wider uppercase ${
                        workflow.activation.kind === 'active'
                            ? 'text-verdigris'
                            : workflow.activation.kind === 'failed'
                              ? 'text-old-blood'
                              : workflow.activation.kind === 'activating'
                                ? 'text-gilt'
                                : 'text-veil'
                    }`}
                >
                    {workflow.enabled ? 'Enabled intent' : 'Disabled'} ·{' '}
                    {workflowActivationLabel(workflow.activation)}
                </span>
            </div>

            <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-ui text-veil text-xs tracking-widest uppercase">
                        State Keys ({entries.length})
                    </h4>
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="font-ui text-gilt hover:text-gilt/80 text-[10px] tracking-widest uppercase transition-colors"
                    >
                        Refresh
                    </button>
                </div>

                {entries.length === 0 ? (
                    <p className="font-manuscript text-veil text-xs italic">No state keys.</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {entries.map((entry) => (
                            <div
                                key={entry.key}
                                className="border-gilt/20 flex items-start justify-between gap-2 border p-3"
                            >
                                {editingKey === entry.key ? (
                                    <div className="flex flex-1 flex-col gap-2">
                                        <span className="font-ui text-gilt text-[10px] tracking-wider uppercase">
                                            {entry.key}
                                        </span>
                                        <input
                                            type="text"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            className="font-data bg-obsidian-ink border-gilt/40 text-parchment w-full border px-2 py-1 text-xs outline-none"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onSetKey(entry.key, editValue);
                                                    setEditingKey(null);
                                                }}
                                                className="font-ui text-verdigris text-[10px] tracking-widest uppercase transition-colors hover:opacity-80"
                                            >
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEditingKey(null)}
                                                className="font-ui text-veil text-[10px] tracking-widest uppercase transition-colors hover:text-parchment"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex flex-1 flex-col gap-0.5">
                                            <span className="font-ui text-gilt text-[10px] tracking-wider uppercase">
                                                {entry.key}
                                            </span>
                                            <span className="font-data text-parchment break-all text-xs">
                                                {entry.value}
                                            </span>
                                        </div>
                                        <div className="flex shrink-0 flex-col gap-1">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingKey(entry.key);
                                                    setEditValue(entry.value);
                                                }}
                                                className="font-ui text-gilt hover:text-gilt/80 text-[10px] tracking-widest uppercase transition-colors"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (
                                                        window.confirm(
                                                            `Delete state key "${entry.key}"?`,
                                                        )
                                                    ) {
                                                        onDeleteKey(entry.key);
                                                    }
                                                }}
                                                className="font-ui text-old-blood hover:text-old-blood/80 text-[10px] tracking-widest uppercase transition-colors"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

async function fetchStateEntries(
    sigil: import('../lib/sigil-adapter.js').SigilAdapter,
    workflowId: string,
): Promise<readonly WorkflowStateEntry[]> {
    try {
        return await sigil.readWorkflowState(workflowId);
    } catch {
        return [];
    }
}

function WorkflowStatePanel({
    workflows,
    sigil,
}: {
    readonly workflows: readonly WorkflowSummary[];
    readonly sigil: import('../lib/sigil-adapter.js').SigilAdapter;
}): ReactElement {
    const [stateMap, setStateMap] = useState<
        Readonly<Record<string, readonly WorkflowStateEntry[]>>
    >({});
    const [loading, setLoading] = useState(true);

    const loadAllState = useCallback(() => {
        setLoading(true);
        Promise.all(
            workflows.map(async (wf) => {
                const entries = await fetchStateEntries(sigil, wf.id);
                return { id: wf.id, entries } as const;
            }),
        )
            .then((results) => {
                const map: Record<string, readonly WorkflowStateEntry[]> = {};
                for (const { id, entries } of results) {
                    map[id] = entries;
                }
                setStateMap(map);
            })
            .catch(() => setStateMap({}))
            .finally(() => setLoading(false));
    }, [workflows, sigil]);

    useEffect(() => {
        loadAllState();
    }, [loadAllState]);

    const handleSetKey = useCallback(
        async (workflowId: string, key: string, value: string) => {
            try {
                const ok = await sigil.setWorkflowStateKey(workflowId, key, value);
                if (ok) {
                    setStateMap((prev) => {
                        const entries = prev[workflowId] ?? [];
                        const existing = entries.findIndex((e) => e.key === key);
                        const updated =
                            existing >= 0
                                ? entries.map((e) => (e.key === key ? { ...e, value } : e))
                                : [...entries, { key, value }];
                        return { ...prev, [workflowId]: updated };
                    });
                }
            } catch (err) {
                console.error('Failed to set workflow state key:', err);
            }
        },
        [sigil],
    );

    const handleDeleteKey = useCallback(
        async (workflowId: string, key: string) => {
            try {
                const ok = await sigil.deleteWorkflowStateKey(workflowId, key);
                if (ok) {
                    setStateMap((prev) => ({
                        ...prev,
                        [workflowId]: (prev[workflowId] ?? []).filter((e) => e.key !== key),
                    }));
                }
            } catch (err) {
                console.error('Failed to delete workflow state key:', err);
            }
        },
        [sigil],
    );

    if (loading) {
        return <p className="font-manuscript text-veil italic">Loading workflow state...</p>;
    }

    if (workflows.length === 0) {
        return (
            <p className="font-manuscript text-veil italic">
                No workflows created yet. Create a workflow and run it to populate state.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="font-manuscript text-veil mb-2 text-sm italic">
                View and manage persistent workflow state keys. Edit values or delete keys to reset
                counters, timestamps, or deduplication markers.
            </p>
            {workflows.map((wf) => (
                <WorkflowStateCard
                    key={wf.id}
                    workflow={wf}
                    entries={stateMap[wf.id] ?? []}
                    onRefresh={async () => {
                        const entries = await fetchStateEntries(sigil, wf.id);
                        setStateMap((prev) => ({ ...prev, [wf.id]: entries }));
                    }}
                    onSetKey={(key, value) => handleSetKey(wf.id, key, value)}
                    onDeleteKey={(key) => handleDeleteKey(wf.id, key)}
                />
            ))}
        </div>
    );
}

export function SettingsSection(): ReactElement {
    const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
    const [pluginsLoading, setPluginsLoading] = useState(true);
    const [properties, setProperties] = useState<Record<string, unknown>>({});
    const [propertiesLoading, setPropertiesLoading] = useState(true);
    const [persistenceError, setPersistenceError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'permissions' | 'properties' | 'workflow-state'>(
        'permissions',
    );
    const workflows = useAppStore((state) => state.workflows);
    const sigil = useSigil();

    const loadData = useCallback(() => {
        setPersistenceError(null);
        setPluginsLoading(true);
        setPropertiesLoading(true);
        sigil
            .listPlugins()
            .then(setPlugins)
            .catch(() => setPlugins([]))
            .finally(() => setPluginsLoading(false));
        sigil
            .readProperties()
            .then(setProperties)
            .catch(() => setProperties({}))
            .finally(() => setPropertiesLoading(false));
    }, [sigil]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handlePermissionOverride = useCallback(
        (pluginId: string, overrides: readonly Capability[]) => {
            sigil
                .setPermissionOverride(pluginId, overrides)
                .then((result) => {
                    if (result.ok) {
                        setPersistenceError(null);
                        setPlugins((prev) =>
                            prev.map((p) =>
                                p.manifest.id === pluginId
                                    ? { ...p, grantedPermissions: overrides }
                                    : p,
                            ),
                        );
                    } else {
                        setPersistenceError(
                            persistenceErrorMessage(result.error, result.diagnostic),
                        );
                        console.error(
                            'Failed to set permission override:',
                            result.error,
                            result.diagnostic,
                        );
                    }
                })
                .catch((err: unknown) => {
                    setPersistenceError(err instanceof Error ? err.message : String(err));
                    console.error('Failed to set permission override:', err);
                });
        },
        [sigil],
    );

    const handlePropertiesSave = useCallback(
        (props: Record<string, unknown>) => {
            sigil
                .saveProperties(props)
                .then((result) => {
                    if (result.ok) {
                        setPersistenceError(null);
                        setProperties(props);
                    } else {
                        setPersistenceError(
                            persistenceErrorMessage(result.error, result.diagnostic),
                        );
                        console.error(
                            'Failed to save properties:',
                            result.error,
                            result.diagnostic,
                        );
                    }
                })
                .catch((err: unknown) => {
                    setPersistenceError(err instanceof Error ? err.message : String(err));
                    console.error('Failed to save properties:', err);
                });
        },
        [sigil],
    );

    const handlePropertiesCancel = useCallback(() => {
        loadData();
    }, [loadData]);

    const showPropertiesLoading = activeTab === 'properties' && propertiesLoading;

    return (
        <SectionShell title="Settings" subtitle="Permissions, properties, and workflow state.">
            <div className="flex flex-col gap-8">
                {persistenceError ? (
                    <p role="alert" className="font-data text-old-blood text-xs">
                        {persistenceError}
                    </p>
                ) : null}
                <div className="border-gilt/30 flex border-b">
                    <button
                        type="button"
                        onClick={() => setActiveTab('permissions')}
                        className={`font-ui px-6 py-3 text-xs tracking-[0.2em] uppercase transition-colors ${
                            activeTab === 'permissions'
                                ? 'border-gilt text-gilt border-b'
                                : 'text-veil hover:text-parchment'
                        }`}
                    >
                        Plugin Permissions
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('properties')}
                        className={`font-ui px-6 py-3 text-xs tracking-[0.2em] uppercase transition-colors ${
                            activeTab === 'properties'
                                ? 'border-gilt text-gilt border-b'
                                : 'text-veil hover:text-parchment'
                        }`}
                    >
                        Properties File
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('workflow-state')}
                        className={`font-ui px-6 py-3 text-xs tracking-[0.2em] uppercase transition-colors ${
                            activeTab === 'workflow-state'
                                ? 'border-gilt text-gilt border-b'
                                : 'text-veil hover:text-parchment'
                        }`}
                    >
                        Workflow State
                    </button>
                </div>

                {activeTab === 'permissions' ? (
                    <PermissionsPanel
                        plugins={plugins}
                        loading={pluginsLoading}
                        onOverride={handlePermissionOverride}
                    />
                ) : activeTab === 'properties' ? (
                    showPropertiesLoading ? (
                        <p className="font-manuscript text-veil italic">Loading properties...</p>
                    ) : (
                        <PropertiesFilePanel
                            properties={properties}
                            onSave={handlePropertiesSave}
                            onCancel={handlePropertiesCancel}
                        />
                    )
                ) : (
                    <WorkflowStatePanel workflows={workflows} sigil={sigil} />
                )}
            </div>
        </SectionShell>
    );
}
