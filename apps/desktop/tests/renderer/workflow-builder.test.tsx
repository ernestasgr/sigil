import type { FileManagerConfig } from '@sigil/schema/nodes/file-manager';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuilderStore } from '../../src/renderer/workflow-builder/builder-store.js';
import { FileManagerConfigForm } from '../../src/renderer/workflow-builder/inspector/config-forms.js';
import { PropertiesPanel } from '../../src/renderer/workflow-builder/inspector/properties-panel.js';
import { DEFAULT_NODE_CATALOG } from '../../src/renderer/workflow-builder/node-catalog.js';
import {
    WorkflowBuilder,
    type WorkflowBuilderProps,
} from '../../src/renderer/workflow-builder/workflow-builder.js';
import type {
    WorkflowDraftDiagnostic,
    WorkflowDraftSaveResult,
} from '../../src/renderer/workflow-builder/workflow-draft.js';

import { createMockSigil, withSigil } from './test-support.js';

interface Deferred<TValue> {
    readonly promise: Promise<TValue>;
    readonly resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
    let resolvePromise: ((value: TValue) => void) | undefined;
    const promise = new Promise<TValue>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise?.(value),
    };
}

function renderBuilder(onSave: WorkflowBuilderProps['onSave'] = async () => {}): void {
    const sigil = createMockSigil();
    render(withSigil(<WorkflowBuilder onSave={onSave} onCancel={vi.fn()} />, sigil));
}

async function addPaletteNode(user: UserEvent, label: string): Promise<void> {
    await user.click(screen.getByRole('button', { name: `Add ${label} Node` }));
}

function connectSwitchBranches(): {
    readonly switchId: string;
    readonly caseTargetId: string;
    readonly defaultTargetId: string;
} {
    const triggerId = useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
    const switchId = useBuilderStore.getState().addNode('switch', { x: 240, y: 0 });
    const caseTargetId = useBuilderStore.getState().addNode('log', { x: 480, y: -80 });
    const defaultTargetId = useBuilderStore.getState().addNode('log', { x: 480, y: 80 });

    useBuilderStore.getState().connect({
        source: triggerId,
        target: switchId,
        sourceHandle: 'out',
        targetHandle: null,
    });
    useBuilderStore.getState().connect({
        source: switchId,
        target: caseTargetId,
        sourceHandle: 'case-1',
        targetHandle: null,
    });
    useBuilderStore.getState().connect({
        source: switchId,
        target: defaultTargetId,
        sourceHandle: 'default',
        targetHandle: null,
    });
    useBuilderStore.getState().selectNode(switchId);

    return { switchId, caseTargetId, defaultTargetId };
}

function addNamedManualDraft(name: string): void {
    useBuilderStore.getState().addNode('manual-trigger', { x: 0, y: 0 });
    useBuilderStore.getState().setPipelineName(name);
}

describe('Workflow Builder renderer behavior', () => {
    beforeEach(() => {
        useBuilderStore.getState().setNodeCatalog(DEFAULT_NODE_CATALOG);
        useBuilderStore.getState().clear();
    });

    it('adds a Node from the accessible library and opens its Properties Panel', async () => {
        const user = userEvent.setup();
        renderBuilder();

        await addPaletteNode(user, 'Manual Trigger');

        expect(screen.getByRole('heading', { name: 'Manual Trigger' })).toBeInTheDocument();
        expect(screen.getByLabelText('Event name')).toHaveValue('file.created');
        expect(
            screen.getByText(
                'Manual Trigger Node added to the canvas. The Inspector is ready for editing.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole('status', { name: 'Workflow save status' })).toHaveTextContent(
            'Unsaved',
        );
    });

    it('edits a Node property through its accessible form control', async () => {
        const user = userEvent.setup();
        renderBuilder();
        await addPaletteNode(user, 'Manual Trigger');

        const nameInput = screen.getByRole('textbox', { name: 'Payload · name' });
        await user.clear(nameInput);
        await user.type(nameInput, 'renamed.txt');

        expect(nameInput).toHaveValue('renamed.txt');
        expect(screen.getByText(/Valid/)).toBeInTheDocument();
    });

    it('supports keyboard activation for the Node Library and Builder interactions', async () => {
        const user = userEvent.setup();
        renderBuilder();

        const paletteButton = screen.getByRole('button', { name: 'Add Log Node' });
        paletteButton.focus();
        await user.keyboard('{Enter}');

        expect(screen.getByRole('heading', { name: 'Log' })).toBeInTheDocument();
    });

    it('preserves connected Switch case and default branches while editing a case value', async () => {
        const user = userEvent.setup();
        const { switchId, caseTargetId, defaultTargetId } = connectSwitchBranches();
        renderBuilder();

        const caseInput = screen.getByRole('combobox', { name: 'Cases entry 1' });
        await user.clear(caseInput);
        await user.type(caseInput, 'file.modified');

        expect(caseInput).toHaveValue('file.modified');
        const result = useBuilderStore.getState().compile();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);

        expect(result.value.edges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: switchId,
                    target: caseTargetId,
                    sourcePort: 'case-1',
                }),
                expect.objectContaining({
                    source: switchId,
                    target: defaultTargetId,
                    sourcePort: 'default',
                }),
            ]),
        );
    });

    it('shows validation diagnostics and disables saving for an invalid Switch case', async () => {
        const user = userEvent.setup();
        connectSwitchBranches();
        renderBuilder();

        await user.clear(screen.getByRole('combobox', { name: 'Cases entry 1' }));

        expect(screen.getByText('1 error')).toBeInTheDocument();
        expect(
            screen.getByText('Switch case case-1 has an empty match value.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('shows field-level feedback while a numeric property is incomplete', async () => {
        const user = userEvent.setup();
        renderBuilder();
        await addPaletteNode(user, 'Delay');

        const millisecondsInput = screen.getByRole('spinbutton', { name: 'Milliseconds' });
        await user.click(millisecondsInput);
        await user.clear(millisecondsInput);

        expect(millisecondsInput).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Enter a finite number.')).toBeInTheDocument();

        await user.tab();
        expect(millisecondsInput).toHaveValue(1000);
    });

    it('renders pending and success states around an asynchronous save', async () => {
        const user = userEvent.setup();
        const pending = createDeferred<WorkflowDraftSaveResult>();
        const onSave = vi.fn(async (name: string): Promise<void> => {
            await useBuilderStore.getState().save(name, async () => pending.promise);
        });
        addNamedManualDraft('Archive Downloads');
        renderBuilder(onSave);

        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith('Archive Downloads');
            expect(screen.getByRole('status', { name: 'Workflow save status' })).toHaveTextContent(
                'Saving',
            );
        });
        expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();

        pending.resolve({ ok: true });

        await waitFor(() => {
            expect(screen.getByRole('status', { name: 'Workflow save status' })).toHaveTextContent(
                'Saved',
            );
            expect(screen.getByText('Workflow saved successfully.')).toBeInTheDocument();
        });
    });

    it('keeps persistence failures visible and offers a retryable save state', async () => {
        const user = userEvent.setup();
        const diagnostic: WorkflowDraftDiagnostic = {
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: 'workflows/archive.json',
            message: 'The destination volume is full.',
            code: 'ENOSPC',
        };
        const onSave = vi.fn(async (name: string): Promise<void> => {
            await useBuilderStore.getState().save(name, async () => ({
                ok: false,
                error: 'The Workflow could not be persisted.',
                diagnostics: [diagnostic],
            }));
        });
        addNamedManualDraft('Archive Downloads');
        renderBuilder(onSave);

        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'The Workflow could not be persisted.',
            );
        });
        expect(screen.getByText('The destination volume is full.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry Save' })).toBeEnabled();
    });
});

describe('Properties Panel in isolation', () => {
    beforeEach(() => {
        useBuilderStore.getState().setNodeCatalog(DEFAULT_NODE_CATALOG);
        useBuilderStore.getState().clear();
    });

    it('provides the empty-state guidance before a Node is selected', () => {
        const sigil = createMockSigil();
        render(withSigil(<PropertiesPanel />, sigil));

        expect(screen.getByRole('heading', { name: 'Inspector' })).toBeInTheDocument();
        expect(
            screen.getByText('Select a node on the canvas to inscribe its properties.'),
        ).toBeInTheDocument();
    });
});

describe('File-manager config form renderer behavior', () => {
    it('falls back to Skip when onConflict is omitted and preserves explicit values', () => {
        const onChange = vi.fn();
        const omittedConfig: FileManagerConfig = {
            action: 'move',
            destination: '/',
        };
        const { rerender } = render(
            <FileManagerConfigForm config={omittedConfig} onChange={onChange} />,
        );

        const conflictSelect = screen.getByRole('combobox', { name: 'On conflict' });
        expect(conflictSelect).toHaveValue('skip');

        rerender(
            <FileManagerConfigForm
                config={{ ...omittedConfig, onConflict: 'overwrite' }}
                onChange={onChange}
            />,
        );

        expect(screen.getByRole('combobox', { name: 'On conflict' })).toHaveValue('overwrite');
    });
});
