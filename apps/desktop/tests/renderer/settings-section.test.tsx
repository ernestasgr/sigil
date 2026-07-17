import { createPropertyRegistry, definePropertyDescriptor } from '@sigil/schema/properties-file';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { propertiesTemplateFromDefaults } from '../../src/renderer/sections/properties-template.js';
import { SettingsSection } from '../../src/renderer/sections/settings-section.js';
import { createMockSigil, withSigil } from './test-support.js';

describe('Settings Properties File template', () => {
    it('uses the registered Engine defaults supplied with the Properties snapshot', async () => {
        const registry = createPropertyRegistry();
        registry.register(definePropertyDescriptor('example-plugin.enabled', z.boolean(), false));
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
});
