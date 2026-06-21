import type { Section } from './store/app-store.js';

export interface SectionMeta {
    readonly id: Section;
    readonly label: string;
}

export const SECTIONS: readonly SectionMeta[] = [
    { id: 'home', label: 'Home' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'events', label: 'Events' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'settings', label: 'Settings' },
];
