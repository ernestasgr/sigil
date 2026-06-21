export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    Log: 'engine:log',
    WorkflowsActive: 'engine:workflows-active',
    EnableWorkflows: 'engine:enable-workflows',
    DisableWorkflows: 'engine:disable-workflows',
} as const;

export type EnginePing = { id: string; type: typeof EngineChannel.Ping };
export type EnginePong = { id: string; type: typeof EngineChannel.Pong; receivedAt: number };
export type EngineFireTestEvent = { type: typeof EngineChannel.FireTestEvent };
export type EngineLog = { type: typeof EngineChannel.Log; line: string };
export type EngineWorkflowsActive = {
    type: typeof EngineChannel.WorkflowsActive;
    active: boolean;
};
export type EngineEnableWorkflows = { type: typeof EngineChannel.EnableWorkflows };
export type EngineDisableWorkflows = { type: typeof EngineChannel.DisableWorkflows };

export type EngineMessage =
    | EnginePing
    | EnginePong
    | EngineFireTestEvent
    | EngineLog
    | EngineWorkflowsActive
    | EngineEnableWorkflows
    | EngineDisableWorkflows;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
    FireTestEvent: 'renderer:fire-test-event',
    EngineLog: 'renderer:engine-log',
    WorkflowsActive: 'renderer:workflows-active',
    EnableWorkflows: 'renderer:enable-workflows',
    DisableWorkflows: 'renderer:disable-workflows',
} as const;
