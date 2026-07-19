import { createPropertyRegistry, definePropertyDescriptor } from '@sigil/schema/properties-file';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { propertiesTemplateFromDefaults } from '../../src/renderer/sections/properties-template.js';
import { SettingsSection } from '../../src/renderer/sections/settings-section.js';
import { useAppStore } from '../../src/renderer/store/app-store.js';
import { createMockSigil, withSigil } from './test-support.js';

afterEach(() => {
    useAppStore.setState({ workflows: [] });
});

describe('Settings Properties File template', () => {
    it('uses the registered Engine defaults supplied with the Properties snapshot', async () => {
        const registry = createPropertyRegistry();
        registry.register(
            definePropertyDescriptor('example-plugin.enabled', z.boolean(), false, 'hot'),
        );
        const defaults = registry.defaults();

        const sigil = createMockSigil();
        vi.mocked(sigil.readProperties).mockResolvedValue({
            properties: {},
            defaults,
        });

        render(withSigil(<SettingsSection />, sigil));
        await waitFor(() => expect(sigil.readProperties).toHaveBeenCalled());

        await userEvent.setup().click(screen.getByRole('button', { name: 'Properties File' }));

        const template = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(template).toHaveValue(propertiesTemplateFromDefaults(defaults));
        expect(registry.schema().safeParse(JSON.parse(template.value)).success).toBe(true);
    });

    it('reports hot-applied values and restart-required values separately', async () => {
        const sigil = createMockSigil();
        vi.mocked(sigil.readProperties).mockResolvedValue({ properties: {} });
        vi.mocked(sigil.saveProperties).mockResolvedValue({
            ok: true,
            applied: { notifyOnWorkflowError: false },
            restartRequired: ['databasePath'],
        });

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();
        await waitFor(() => expect(sigil.readProperties).toHaveBeenCalled());
        await user.click(screen.getByRole('button', { name: 'Properties File' }));

        const editor = screen.getByRole('textbox');
        fireEvent.change(editor, {
            target: { value: '{"notifyOnWorkflowError":false,"databasePath":"next.db"}' },
        });
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(sigil.saveProperties).toHaveBeenCalled());
        expect(screen.getByRole('status')).toHaveTextContent('Applied now');
        expect(screen.getByRole('status')).toHaveTextContent('Restart required: databasePath');
    });

    it.each([
        {
            kind: 'validation' as const,
            error: 'notifyOnWorkflowError: expected boolean',
            issues: ['notifyOnWorkflowError: expected boolean'],
            expected: 'Validation error',
        },
        {
            kind: 'write' as const,
            error: 'disk full',
            diagnostic: {
                kind: 'persistence' as const,
                operation: 'write' as const,
                phase: 'replace' as const,
                path: 'sigil.properties.json',
                message: 'disk full',
            },
            expected: 'Write failure',
        },
    ])('labels $kind failures distinctly', async ({
        kind,
        error,
        diagnostic,
        issues,
        expected,
    }) => {
        const sigil = createMockSigil();
        vi.mocked(sigil.readProperties).mockResolvedValue({ properties: {} });
        vi.mocked(sigil.saveProperties).mockResolvedValue(
            kind === 'validation'
                ? { ok: false, kind, error, issues }
                : { ok: false, kind, error, diagnostic },
        );

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();
        await waitFor(() => expect(sigil.readProperties).toHaveBeenCalled());
        await user.click(screen.getByRole('button', { name: 'Properties File' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(expected));
    });
});

describe('Settings Workflow State', () => {
    it('renders typed values, including false and zero, without guessing their type', async () => {
        useAppStore.setState({
            workflows: [
                {
                    id: 'wf-typed',
                    name: 'Typed State',
                    enabled: true,
                    activation: { kind: 'active' },
                },
            ],
        });
        const sigil = createMockSigil();
        vi.mocked(sigil.readWorkflowState).mockResolvedValue([
            { key: 'count', type: 'number', value: 0 },
            { key: 'enabled', type: 'boolean', value: false },
            { key: 'empty', type: 'string', value: '' },
        ]);

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Workflow State' }));

        await waitFor(() => {
            expect(sigil.readWorkflowState).toHaveBeenCalledWith('wf-typed');
        });
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('false')).toBeInTheDocument();
        expect(screen.getByText('Typed State')).toBeInTheDocument();
        expect(document.querySelector('[data-value-type="number"]')).toBeInTheDocument();
        expect(document.querySelector('[data-value-type="boolean"]')).toBeInTheDocument();
        expect(document.querySelector('[data-value-type="string"]')).toBeInTheDocument();

        const editButtons = screen.getAllByRole('button', { name: 'Edit' });
        await user.click(editButtons[0]);
        const input = screen.getByRole('textbox');
        await user.clear(input);
        await user.type(input, '42');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(sigil.setWorkflowStateKey).toHaveBeenCalledWith('wf-typed', 'count', 42);
        });
        expect(document.querySelector('[data-value-type="number"]')).toHaveTextContent('42');

        await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
        const booleanInput = screen.getByRole('textbox');
        expect(booleanInput).toHaveValue('false');
        await user.clear(booleanInput);
        await user.type(booleanInput, 'true');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(sigil.setWorkflowStateKey).toHaveBeenCalledWith('wf-typed', 'enabled', true);
        });
        expect(document.querySelector('[data-value-type="boolean"]')).toHaveTextContent('true');
    });
});
