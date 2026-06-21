import type { ReactElement } from 'react';

import type { Section } from '../store/app-store.js';
import { useAppStore } from '../store/app-store.js';
import { EventsSection } from '../sections/events-section.js';
import { HomeSection } from '../sections/home-section.js';
import { PluginsSection } from '../sections/plugins-section.js';
import { SettingsSection } from '../sections/settings-section.js';
import { WorkflowsSection } from '../sections/workflows-section.js';

const SECTION_VIEWS: Readonly<Record<Section, () => ReactElement>> = {
    home: HomeSection,
    workflows: WorkflowsSection,
    events: EventsSection,
    plugins: PluginsSection,
    settings: SettingsSection,
};

export function SectionRouter(): ReactElement {
    const activeSection = useAppStore((state) => state.activeSection);
    const SectionView = SECTION_VIEWS[activeSection];
    return <SectionView />;
}
