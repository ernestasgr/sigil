import type { ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';

export function PluginsSection(): ReactElement {
    return (
        <SectionShell title="Plugins" subtitle="Isolated workers, manifest-bound.">
            <p className="font-manuscript text-veil italic">
                No plugins installed. Triggers and actions will appear here once loaded.
            </p>
        </SectionShell>
    );
}
