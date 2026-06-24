import type { ReactElement } from 'react';

import { assertNever } from '../../../shared/assert-never.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button.js';
import { useBuilderStore } from '../builder-store.js';
import type { NodeSpec } from '../node-defaults.js';
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

export function PropertiesPanel(): ReactElement {
    const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
    const nodes = useBuilderStore((state) => state.nodes);
    const updateSpec = useBuilderStore((state) => state.updateSpec);
    const removeNode = useBuilderStore((state) => state.removeNode);

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
                {renderForm(spec, (next) => updateSpec(node.id, next))}
            </div>
            <footer className="border-gilt/40 border-t p-5">
                <Button variant="destructive" size="sm" onClick={() => removeNode(node.id)}>
                    Delete node
                </Button>
            </footer>
        </div>
    );
}

function renderForm(spec: NodeSpec, onChange: (next: NodeSpec) => void): ReactElement {
    switch (spec.type) {
        case 'file-watcher':
            return (
                <FileWatcherConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'file-watcher', config })}
                />
            );
        case 'manual-trigger':
            return (
                <ManualTriggerConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'manual-trigger', config })}
                />
            );
        case 'if-else':
            return (
                <IfElseConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'if-else', config })}
                />
            );
        case 'switch':
            return (
                <SwitchConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'switch', config })}
                />
            );
        case 'file-manager':
            return (
                <FileManagerConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'file-manager', config })}
                />
            );
        case 'notification':
            return (
                <NotificationConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'notification', config })}
                />
            );
        case 'log':
            return (
                <LogConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'log', config })}
                />
            );
        case 'delay':
            return (
                <DelayConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'delay', config })}
                />
            );
        case 'state-get':
            return (
                <StateGetConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'state-get', config })}
                />
            );
        case 'state-set':
            return (
                <StateSetConfigForm
                    config={spec.config}
                    onChange={(config) => onChange({ type: 'state-set', config })}
                />
            );
        default:
            return assertNever(spec);
    }
}
