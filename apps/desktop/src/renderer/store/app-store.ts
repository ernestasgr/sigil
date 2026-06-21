import { create } from 'zustand';

export type Section = 'home' | 'workflows' | 'events' | 'plugins' | 'settings';

export interface AppState {
    readonly activeSection: Section;
    readonly workflowsActive: boolean;
    readonly navigate: (section: Section) => void;
    readonly setWorkflowsActive: (active: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
    activeSection: 'home',
    workflowsActive: false,
    navigate: (section) => {
        set({ activeSection: section });
    },
    setWorkflowsActive: (active) => {
        set({ workflowsActive: active });
    },
}));
