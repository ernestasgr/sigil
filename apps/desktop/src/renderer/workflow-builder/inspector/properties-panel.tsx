import { type ReactElement, useEffect, useRef } from 'react';
import { Button } from '../../components/ui/button.js';
import { useSigil } from '../../lib/use-sigil.js';
import { cn } from '../../lib/utils.js';
import { useBuilderStore } from '../builder-store.js';
import { EVENT_CATALOG, type EventCatalog } from '../event-catalog.js';
import {
    CATEGORY_TEXT,
    DEFAULT_NODE_CATALOG,
    isPluginNodeSpec,
    type NodeCatalog,
    type NodeSpec,
    nodeSpecWithConfig,
    type PluginNodeSpec,
    type ResolvedNodeCatalogEntry,
    resolveNodeCatalogEntry,
} from '../node-catalog.js';

function PluginReadOnlyDiagnostic({
    spec,
    entry,
}: {
    readonly spec: PluginNodeSpec;
    readonly entry: ResolvedNodeCatalogEntry;
}): ReactElement {
    return (
        <div
            role="alert"
            className="border-old-blood/50 bg-old-blood/10 flex flex-col gap-2 border p-3"
        >
            <p className="font-ui text-old-blood-foreground text-xs">Read-only Plugin Node</p>
            <p className="font-data text-parchment text-[10px] break-words">
                {entry.readOnlyReason ?? entry.description}
            </p>
            <p className="font-data text-veil-foreground text-[10px] break-words">
                Identity: {spec.pluginId} · {spec.type}
            </p>
        </div>
    );
}

function NodeConfigForm({
    spec,
    entry,
    onChange,
    eventCatalog,
}: {
    readonly spec: NodeSpec;
    readonly entry: ResolvedNodeCatalogEntry;
    readonly onChange: (next: NodeSpec) => void;
    readonly eventCatalog: EventCatalog;
}): ReactElement {
    if (!entry.Form || entry.authoring === 'read-only') {
        if (isPluginNodeSpec(spec)) {
            return <PluginReadOnlyDiagnostic spec={spec} entry={entry} />;
        }
        return (
            <p role="alert" className="text-old-blood-foreground font-data text-[10px]">
                Node "{spec.type}" has no authoring adapter.
            </p>
        );
    }

    const Form = entry.Form;
    return (
        <Form
            config={spec.config}
            onChange={(config) => onChange(nodeSpecWithConfig(spec, config))}
            eventCatalog={eventCatalog}
        />
    );
}

export function PropertiesPanel({
    nodeCatalog = DEFAULT_NODE_CATALOG,
    eventCatalog = EVENT_CATALOG,
}: {
    readonly nodeCatalog?: NodeCatalog;
    readonly eventCatalog?: EventCatalog;
}): ReactElement {
    const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
    const nodes = useBuilderStore((state) => state.nodes);
    const updateSpec = useBuilderStore((state) => state.updateSpec);
    const removeNode = useBuilderStore((state) => state.removeNode);
    const sigil = useSigil();
    const panelRef = useRef<HTMLElement>(null);

    const node = selectedNodeId ? nodes.find((entry) => entry.id === selectedNodeId) : undefined;
    const selectedNodeIdForFocus = node?.id;

    useEffect(() => {
        if (selectedNodeIdForFocus === undefined) return;
        panelRef.current?.querySelector<HTMLElement>('[data-inspector-control="true"]')?.focus();
    }, [selectedNodeIdForFocus]);

    if (!node) {
        return (
            <section
                ref={panelRef}
                aria-labelledby="workflow-inspector-title"
                className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
            >
                <h2
                    id="workflow-inspector-title"
                    className="font-display text-gilt text-xs tracking-[0.3em] uppercase"
                >
                    Inspector
                </h2>
                <p className="font-manuscript text-veil-foreground text-sm italic">
                    Select a node on the canvas to inscribe its properties.
                </p>
            </section>
        );
    }

    const spec = node.data;
    const def = resolveNodeCatalogEntry(spec, nodeCatalog);

    return (
        <section
            ref={panelRef}
            aria-labelledby="workflow-inspector-title"
            className="flex h-full flex-col"
        >
            <header className="border-gilt/40 border-b px-5 py-4">
                <span
                    className={cn(
                        'text-[10px] tracking-widest uppercase',
                        CATEGORY_TEXT[def.category],
                    )}
                >
                    {def.category}
                </span>
                <h2
                    id="workflow-inspector-title"
                    className="font-display text-gilt text-sm tracking-[0.25em] uppercase"
                >
                    {def.label}
                </h2>
                <p className="font-manuscript text-veil-foreground mt-1 text-xs italic">
                    {def.description}
                </p>
            </header>
            <div className="flex flex-col gap-4 overflow-auto p-5">
                <NodeConfigForm
                    key={node.id}
                    spec={spec}
                    entry={def}
                    onChange={(next) => updateSpec(node.id, next)}
                    eventCatalog={eventCatalog}
                />
            </div>
            <footer className="border-gilt/40 flex items-center gap-2 border-t p-5">
                {!isPluginNodeSpec(spec) && spec.type === 'manual-trigger' ? (
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                            const result = useBuilderStore.getState().compile();
                            if (result.ok) {
                                sigil.fireManualTrigger(result.value).catch((err: unknown) => {
                                    console.error('Failed to fire manual trigger:', err);
                                });
                            }
                        }}
                    >
                        Fire
                    </Button>
                ) : null}
                <Button variant="destructive" size="sm" onClick={() => removeNode(node.id)}>
                    Delete node
                </Button>
            </footer>
        </section>
    );
}
