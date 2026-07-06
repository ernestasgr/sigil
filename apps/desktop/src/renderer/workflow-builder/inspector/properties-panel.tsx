import type { ReactElement } from 'react';

import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button.js';
import { useSigil } from '../../lib/sigil-context.js';
import { useBuilderStore } from '../builder-store.js';
import type { NodeSpec } from '../node-registry.js';
import { CATEGORY_TEXT, nodeTypeDef } from '../node-registry.js';

export function PropertiesPanel(): ReactElement {
    const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
    const nodes = useBuilderStore((state) => state.nodes);
    const updateSpec = useBuilderStore((state) => state.updateSpec);
    const removeNode = useBuilderStore((state) => state.removeNode);
    const sigil = useSigil();

    const node = selectedNodeId ? nodes.find((entry) => entry.id === selectedNodeId) : undefined;

    if (!node) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="font-display text-gilt text-xs tracking-[0.3em] uppercase">
                    Inspector
                </span>
                <p className="font-manuscript text-veil text-sm italic">
                    Select a node on the canvas to inscribe its properties.
                </p>
            </div>
        );
    }

    const spec = node.data;
    const def = nodeTypeDef(spec.type);

    return (
        <div className="flex h-full flex-col">
            <header className="border-gilt/40 border-b px-5 py-4">
                <span
                    className={cn(
                        'text-[10px] tracking-widest uppercase',
                        CATEGORY_TEXT[def.category],
                    )}
                >
                    {def.category}
                </span>
                <h2 className="font-display text-gilt text-sm tracking-[0.25em] uppercase">
                    {def.label}
                </h2>
                <p className="font-manuscript text-veil mt-1 text-xs italic">{def.description}</p>
            </header>
            <div className="flex flex-col gap-4 overflow-auto p-5">
                <def.Form
                    config={spec.config}
                    onChange={(config) =>
                        updateSpec(node.id, { type: spec.type, config } as NodeSpec)
                    }
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
        </div>
    );
}
