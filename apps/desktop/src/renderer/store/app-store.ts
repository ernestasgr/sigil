import { create } from 'zustand';

import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import type { WorkflowSummary } from '../../shared/workflow.js';
import {
    createTelemetryEntry,
    createTelemetryIndex,
    type TelemetryEntry,
    type TelemetryIndex,
} from './telemetry-index.js';

export type Section = 'home' | 'workflows' | 'events' | 'plugins' | 'settings';
export type WorkflowView = 'list' | 'builder';

export interface LogEntry {
    readonly id: number;
    readonly line: string;
}

export type BusEventEntry = TelemetryEntry;

const LOG_CAP = 200;

function createIdCounter(): () => number {
    let next = 0;
    return () => next++;
}

const nextLogId = createIdCounter();
const nextBusEventId = createIdCounter();

export interface AppState {
    readonly activeSection: Section;
    readonly workflows: readonly WorkflowSummary[];
    readonly logs: readonly LogEntry[];
    readonly busEvents: readonly BusEventEntry[];
    readonly telemetryIndex: TelemetryIndex;
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
    telemetryIndex: createTelemetryIndex(),
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
            const entry: LogEntry = { id: nextLogId(), line };
            const logs = [...state.logs, entry];
            if (logs.length <= LOG_CAP) return { logs };
            return { logs: logs.slice(logs.length - LOG_CAP) };
        });
    },
    appendBusEvent: (event) => {
        const entry = createTelemetryEntry(nextBusEventId(), event);
        set((state) => {
            const telemetryIndex = state.telemetryIndex.append(entry);
            return { telemetryIndex, busEvents: telemetryIndex.entries };
        });
    },
    setWorkflowView: (view) => {
        set({ workflowView: view });
    },
    setEditingWorkflowId: (id) => {
        set({ editingWorkflowId: id });
    },
}));
