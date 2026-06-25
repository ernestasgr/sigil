import { create } from 'zustand';

import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import type { WorkflowSummary } from '../../shared/workflow.js';

export type Section = 'home' | 'workflows' | 'events' | 'plugins' | 'settings';
export type WorkflowView = 'list' | 'builder';

export interface LogEntry {
    readonly id: number;
    readonly line: string;
}

export interface BusEventEntry {
    readonly id: number;
    readonly name: string;
    readonly payload: unknown;
    readonly timestamp: number;
}

const LOG_CAP = 200;
const BUS_EVENT_CAP = 500;
let nextLogId = 0;
let nextBusEventId = 0;

export interface AppState {
    readonly activeSection: Section;
    readonly workflows: readonly WorkflowSummary[];
    readonly logs: readonly LogEntry[];
    readonly busEvents: readonly BusEventEntry[];
    readonly workflowView: WorkflowView;
    readonly editingWorkflowId: string | null;
    readonly navigate: (section: Section) => void;
    readonly setWorkflows: (workflows: readonly WorkflowSummary[]) => void;
    readonly appendLog: (line: string) => void;
    readonly appendBusEvent: (event: EngineBusEventPayload) => void;
    readonly setWorkflowView: (view: WorkflowView) => void;
    readonly setEditingWorkflowId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
    activeSection: 'home',
    workflows: [],
    logs: [],
    busEvents: [],
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
    appendBusEvent: (event) => {
        set((state) => {
            const entry: BusEventEntry = {
                id: nextBusEventId++,
                name: event.name,
                payload: event.payload,
                timestamp: Date.now(),
            };
            const busEvents = [...state.busEvents, entry];
            if (busEvents.length <= BUS_EVENT_CAP) return { busEvents };
            return { busEvents: busEvents.slice(busEvents.length - BUS_EVENT_CAP) };
        });
    },
    setWorkflowView: (view) => {
        set({ workflowView: view });
    },
    setEditingWorkflowId: (id) => {
        set({ editingWorkflowId: id });
    },
}));
