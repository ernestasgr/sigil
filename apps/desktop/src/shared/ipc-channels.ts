import type { WorkflowSummary } from './workflow.js';

export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    Log: 'engine:log',
    WorkflowsList: 'engine:workflows-list',
    ToggleWorkflow: 'engine:toggle-workflow',
} as const;

export type EnginePing = { id: string; type: typeof EngineChannel.Ping };
export type EnginePong = { id: string; type: typeof EngineChannel.Pong; receivedAt: number };
export type EngineFireTestEvent = { type: typeof EngineChannel.FireTestEvent };
export type EngineLog = { type: typeof EngineChannel.Log; line: string };
export type EngineWorkflowsList = {
    type: typeof EngineChannel.WorkflowsList;
    workflows: readonly WorkflowSummary[];
};
export type EngineToggleWorkflow = {
    type: typeof EngineChannel.ToggleWorkflow;
    id: string;
};

export type EngineMessage =
    | EnginePing
    | EnginePong
    | EngineFireTestEvent
    | EngineLog
    | EngineWorkflowsList
    | EngineToggleWorkflow;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
    FireTestEvent: 'renderer:fire-test-event',
    EngineLog: 'renderer:engine-log',
    WorkflowsList: 'renderer:workflows-list',
    ToggleWorkflow: 'renderer:toggle-workflow',
} as const;
