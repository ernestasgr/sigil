import { create } from 'zustand';

import type { WorkflowSummary } from '../../shared/workflow.js';

export type Section = 'home' | 'workflows' | 'events' | 'plugins' | 'settings';
export type WorkflowView = 'list' | 'builder';

export interface LogEntry {
    readonly id: number;
    readonly line: string;
}

const LOG_CAP = 200;
let nextLogId = 0;

export interface AppState {
    readonly activeSection: Section;
    readonly workflows: readonly WorkflowSummary[];
    readonly logs: readonly LogEntry[];
    readonly workflowView: WorkflowView;
    readonly editingWorkflowId: string | null;
    readonly navigate: (section: Section) => void;
    readonly setWorkflows: (workflows: readonly WorkflowSummary[]) => void;
    readonly appendLog: (line: string) => void;
    readonly setWorkflowView: (view: WorkflowView) => void;
    readonly setEditingWorkflowId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
    activeSection: 'home',
    workflows: [],
    logs: [],
    workflowView: 'list',
    editingWorkflowId: null,
    navigate: (section) => {
        set({ activeSection: section });
    },
    setWorkflows: (nextWorkflows) => {
        set({ workflows: nextWorkflows });
    },
    appendLog: (line) => {
        set((state) => {
            const entry: LogEntry = { id: nextLogId++, line };
            const logs = [...state.logs, entry];
            if (logs.length <= LOG_CAP) return { logs };
            return { logs: logs.slice(logs.length - LOG_CAP) };
        });
    },
    setWorkflowView: (view) => {
        set({ workflowView: view });
    },
    setEditingWorkflowId: (id) => {
        set({ editingWorkflowId: id });
    },
}));
