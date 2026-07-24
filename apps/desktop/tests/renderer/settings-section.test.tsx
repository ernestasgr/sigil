import { createPropertyRegistry, definePropertyDescriptor } from '@sigil/schema/properties-file';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { propertiesTemplateFromDefaults } from '../../src/renderer/sections/properties-template.js';
import { SettingsSection } from '../../src/renderer/sections/settings-section.js';
import { useAppStore } from '../../src/renderer/store/app-store.js';
import type { PluginInfo } from '../../src/shared/plugin-info.js';
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
    ])(
        'labels $kind failures distinctly',
        async ({ kind, error, diagnostic, issues, expected }) => {
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
        },
    );
});

describe('Settings Plugin Permissions', () => {
    const pluginInfo = {
        manifest: {
            id: 'plugin-1',
            version: '1.0.0',
            permissions: ['filesystem.read'],
            emits: [],
        },
        grantedPermissions: ['filesystem.read'],
    } satisfies PluginInfo;

    it('offers toggles only for capabilities declared by the Plugin Manifest', async () => {
        const sigil = createMockSigil();
        vi.mocked(sigil.listPlugins).mockResolvedValue([pluginInfo]);
        vi.mocked(sigil.readProperties).mockResolvedValue({ properties: {} });

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();
        await waitFor(() => expect(screen.getByText('plugin-1')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Override' }));

        expect(screen.getByRole('checkbox', { name: 'Filesystem Read' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Network' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Clipboard' })).not.toBeInTheDocument();
    });

    async function submitPermissionOverride(
        result:
            | {
                  readonly ok: true;
                  readonly grantedPermissions: readonly ['filesystem.read'];
                  readonly cancelledRunIds: readonly string[];
              }
            | {
                  readonly ok: false;
                  readonly kind: 'domain';
                  readonly code: 'unknown_plugin';
                  readonly pluginId: string;
                  readonly error: string;
              }
            | {
                  readonly ok: false;
                  readonly kind: 'persistence';
                  readonly error: string;
                  readonly diagnostic: {
                      readonly kind: 'persistence';
                      readonly operation: 'write';
                      readonly phase: 'replace';
                      readonly path: string;
                      readonly message: string;
                  };
              },
    ): Promise<void> {
        const sigil = createMockSigil();
        vi.mocked(sigil.listPlugins).mockResolvedValue([pluginInfo]);
        vi.mocked(sigil.readProperties).mockResolvedValue({ properties: {} });
        vi.mocked(sigil.setPermissionOverride).mockResolvedValue(result);

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();

        await waitFor(() => expect(screen.getByText('plugin-1')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Override' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(sigil.setPermissionOverride).toHaveBeenCalledWith('plugin-1', [
                'filesystem.read',
            ]),
        );
    }

    it('updates PluginInfo from the Engine effective result instead of the raw selection', async () => {
        const sigil = createMockSigil();
        vi.mocked(sigil.listPlugins).mockResolvedValue([pluginInfo]);
        vi.mocked(sigil.readProperties).mockResolvedValue({ properties: {} });
        vi.mocked(sigil.setPermissionOverride).mockResolvedValue({
            ok: true,
            grantedPermissions: [],
            cancelledRunIds: [],
        });

        render(withSigil(<SettingsSection />, sigil));
        const user = userEvent.setup();

        await waitFor(() => expect(screen.getByText('plugin-1')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Override' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(screen.getByText('None granted')).toBeInTheDocument());
    });

    it('reports an unknown Plugin rejection without labeling it as a write failure', async () => {
        await submitPermissionOverride({
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId: 'plugin-1',
            error: 'Plugin "plugin-1" is not registered in the Manifest Registry.',
        });

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Permission override rejected: Plugin "plugin-1" is not registered in the Manifest Registry.',
            ),
        );
        expect(screen.getByRole('alert')).not.toHaveTextContent('Write failure');
    });

    it('reports a registered Plugin persistence failure with its diagnostic', async () => {
        await submitPermissionOverride({
            ok: false,
            kind: 'persistence',
            error: 'replacement denied',
            diagnostic: {
                kind: 'persistence',
                operation: 'write',
                phase: 'replace',
                path: 'C:/permission-overrides.json',
                message: 'replacement denied',
            },
        });

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                'replacement denied [replace] C:/permission-overrides.json',
            ),
        );
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
