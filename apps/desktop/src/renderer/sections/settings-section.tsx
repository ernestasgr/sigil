import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { Capability } from '@sigil/schema/manifest';

import type { PluginInfo } from '../../shared/plugin-info.js';
import { Button } from '../components/ui/button.js';
import { SectionShell } from '../components/section-shell.js';

const ALL_CAPABILITIES: readonly Capability[] = [
    'filesystem.read',
    'filesystem.write',
    'network',
    'clipboard',
    'processes',
    'display',
    'keyboard.global',
    'microphone',
];

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
                className="border-gilt/60 size-4 cursor-pointer appearance-none border bg-transparent checked:bg-gilt checked:hover:bg-gilt/80"
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

function PropertiesEditor({
    properties,
    onSave,
    onCancel,
}: {
    readonly properties: Record<string, unknown>;
    readonly onSave: (props: Record<string, unknown>) => void;
    readonly onCancel: () => void;
}): ReactElement {
    const [jsonText, setJsonText] = useState(() => JSON.stringify(properties, null, 4));
    const [error, setError] = useState<string | null>(null);

    const handleSave = (): void => {
        try {
            const parsed = JSON.parse(jsonText);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setError('Root value must be a JSON object');
                return;
            }
            setError(null);
            onSave(parsed as Record<string, unknown>);
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
    onOverride,
}: {
    readonly plugins: readonly PluginInfo[];
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
            {plugins.length === 0 ? (
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

export function SettingsSection(): ReactElement {
    const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
    const [properties, setProperties] = useState<Record<string, unknown>>({});
    const [activeTab, setActiveTab] = useState<'permissions' | 'properties'>('permissions');
    const loadData = useCallback(() => {
        window.sigil
            .listPlugins()
            .then(setPlugins)
            .catch(() => setPlugins([]));
        window.sigil
            .readProperties()
            .then(setProperties)
            .catch(() => setProperties({}));
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handlePermissionOverride = useCallback(
        (pluginId: string, overrides: readonly Capability[]) => {
            window.sigil
                .setPermissionOverride(pluginId, overrides)
                .then(() => {
                    setPlugins((prev) =>
                        prev.map((p) =>
                            p.manifest.id === pluginId
                                ? { ...p, grantedPermissions: overrides }
                                : p,
                        ),
                    );
                })
                .catch((err: unknown) => {
                    console.error('Failed to set permission override:', err);
                });
        },
        [],
    );

    const handlePropertiesSave = useCallback((props: Record<string, unknown>) => {
        window.sigil
            .saveProperties(props)
            .then((ok) => {
                if (ok) {
                    setProperties(props);
                }
            })
            .catch((err: unknown) => {
                console.error('Failed to save properties:', err);
            });
    }, []);

    const handlePropertiesCancel = useCallback(() => {
        loadData();
    }, [loadData]);

    return (
        <SectionShell title="Settings" subtitle="Permissions and the properties file.">
            <div className="flex flex-col gap-8">
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
                </div>

                {activeTab === 'permissions' ? (
                    <PermissionsPanel plugins={plugins} onOverride={handlePermissionOverride} />
                ) : (
                    <PropertiesFilePanel
                        properties={properties}
                        onSave={handlePropertiesSave}
                        onCancel={handlePropertiesCancel}
                    />
                )}
            </div>
        </SectionShell>
    );
}
