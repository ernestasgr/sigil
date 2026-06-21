import type { ReactElement } from 'react';

import { SectionShell } from '../components/section-shell.js';
import { Button } from '../components/ui/button.js';
import { useAppStore } from '../store/app-store.js';

export function HomeSection(): ReactElement {
    const logs = useAppStore((state) => state.logs);

    const handleFire = (): void => {
        void window.sigil.fireTestEvent().catch((error: unknown) => {
            console.error('Failed to fire test event', error);
        });
    };

    return (
        <SectionShell title="Home" subtitle="The working table — active sigils and recent echoes.">
            <div className="flex flex-col gap-6">
                <Button onClick={handleFire}>Fire test event</Button>
                <div className="border-gilt/40 border">
                    <h2 className="border-gilt/40 border-b font-ui text-veil px-4 py-2 text-xs tracking-widest uppercase">
                        Engine log
                    </h2>
                    <ul className="divide-gilt/30 divide-y font-data">
                        {logs.length === 0 ? (
                            <li className="font-manuscript text-veil px-4 py-3 text-sm italic">
                                No events yet — fire the trigger or toggle a workflow from the tray.
                            </li>
                        ) : (
                            logs.map((entry) => (
                                <li key={entry.id} className="text-parchment px-4 py-2 text-sm">
                                    {entry.line}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            </div>
        </SectionShell>
    );
}
