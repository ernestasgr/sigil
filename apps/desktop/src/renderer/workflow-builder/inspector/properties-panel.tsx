import { type ReactElement, useEffect, useRef } from 'react';
import { Button } from '../../components/ui/button.js';
import { useSigil } from '../../lib/use-sigil.js';
import { cn } from '../../lib/utils.js';
import { useBuilderStore } from '../builder-store.js';
import type { NodeSpec } from '../node-registry.js';
import { CATEGORY_TEXT, nodeTypeDef } from '../node-registry.js';
import {
    DelayConfigForm,
    FileManagerConfigForm,
    FileWatcherConfigForm,
    IfElseConfigForm,
    LogConfigForm,
    ManualTriggerConfigForm,
    NotificationConfigForm,
    StateGetConfigForm,
    StateSetConfigForm,
    SwitchConfigForm,
} from './config-forms.js';

function NodeConfigForm({
    spec,
    onChange,
}: {
    readonly spec: NodeSpec;
    readonly onChange: (next: NodeSpec) => void;
}): ReactElement {
    switch (spec.type) {
        case 'file-watcher':
            return (
                <FileWatcherConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'manual-trigger':
            return (
                <ManualTriggerConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'if-else':
            return (
                <IfElseConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'switch':
            return (
                <SwitchConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'file-manager':
            return (
                <FileManagerConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'notification':
            return (
                <NotificationConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'state-get':
            return (
                <StateGetConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'state-set':
            return (
                <StateSetConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'log':
            return (
                <LogConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        case 'delay':
            return (
                <DelayConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: spec.type, config })}
                />
            );
        default:
            return assertNever(spec);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled node type: ${JSON.stringify(value)}`);
}

export function PropertiesPanel(): ReactElement {
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
    const def = nodeTypeDef(spec.type);

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
                    onChange={(next) => updateSpec(node.id, next)}
                />
            </div>
            <footer className="border-gilt/40 flex items-center gap-2 border-t p-5">
                {spec.type === 'manual-trigger' ? (
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
