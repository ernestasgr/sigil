import { create } from 'zustand';

import type { WorkflowSummary } from '../../shared/workflow.js';

export type Section = 'home' | 'workflows' | 'events' | 'plugins' | 'settings';

export interface AppState {
    readonly activeSection: Section;
    readonly workflows: readonly WorkflowSummary[];
    readonly navigate: (section: Section) => void;
    readonly setWorkflows: (workflows: readonly WorkflowSummary[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
    activeSection: 'home',
    workflows: [],
    navigate: (section) => {
        set({ activeSection: section });
    },
    setWorkflows: (nextWorkflows) => {
        set({ workflows: nextWorkflows });
    },
}));
