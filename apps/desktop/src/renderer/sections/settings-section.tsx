import type { ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';

export function SettingsSection(): ReactElement {
    return (
        <SectionShell title="Settings" subtitle="Permissions and the properties file.">
            <p className="font-manuscript text-veil italic">
                The settings editor arrives in a later slice — permissions, engine preferences, and
                plugin defaults.
            </p>
        </SectionShell>
    );
}
