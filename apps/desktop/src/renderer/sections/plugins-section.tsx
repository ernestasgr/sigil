import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { PluginInfo } from '../../shared/plugin-info.js';
import { SectionShell } from '../components/section-shell.js';
import { useSigil } from '../lib/use-sigil.js';

function PluginCard({ info }: { readonly info: PluginInfo }): ReactElement {
    return (
        <div className="border-gilt/30 border p-6">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="font-ui text-gilt text-lg tracking-wider uppercase">
                        {info.manifest.id}
                    </h3>
                    <p className="font-data text-veil mt-1 text-xs">v{info.manifest.version}</p>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-6">
                <div>
                    <h4 className="font-ui text-veil mb-2 text-xs tracking-widest uppercase">
                        Required Permissions
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

                <div>
                    <h4 className="font-ui text-veil mb-2 text-xs tracking-widest uppercase">
                        Emitted Events
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {info.manifest.emits.map((event) => (
                            <span
                                key={event}
                                className="font-data border-verdigris/40 text-verdigris border px-2 py-0.5 text-[10px] tracking-wider uppercase"
                            >
                                {event}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-4">
                <h4 className="font-ui text-veil mb-2 text-xs tracking-widest uppercase">
                    Granted Permissions
                </h4>
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
            </div>
        </div>
    );
}

export function PluginsSection(): ReactElement {
    const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const sigil = useSigil();

    const load = useCallback(() => {
        setLoading(true);
        sigil
            .listPlugins()
            .then(setPlugins)
            .catch((err: unknown) => {
                console.error('Failed to list plugins:', err);
                setPlugins([]);
            })
            .finally(() => setLoading(false));
    }, [sigil]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <SectionShell title="Plugins" subtitle="Isolated workers, manifest-bound.">
            {loading ? (
                <p className="font-manuscript text-veil italic">Loading plugins...</p>
            ) : plugins.length === 0 ? (
                <p className="font-manuscript text-veil italic">
                    No plugins installed. Triggers and actions will appear here once loaded.
                </p>
            ) : (
                <div className="flex flex-col gap-4">
                    {plugins.map((plugin) => (
                        <PluginCard key={plugin.manifest.id} info={plugin} />
                    ))}
                </div>
            )}
        </SectionShell>
    );
}
