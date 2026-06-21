import type { ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';

export function EventsSection(): ReactElement {
    return (
        <SectionShell title="Events" subtitle="The live inspector — every echo on the Bus.">
            <p className="font-manuscript text-veil italic">
                No events yet. The inspector will show every Event flowing through the Bus as it
                happens.
            </p>
        </SectionShell>
    );
}
