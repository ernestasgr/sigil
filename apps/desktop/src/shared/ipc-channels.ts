import type { CompiledPipeline } from '@sigil/schema';

import type { WorkflowSummary } from './workflow.js';

export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    Log: 'engine:log',
    WorkflowsList: 'engine:workflows-list',
    ToggleWorkflow: 'engine:toggle-workflow',
    CreateWorkflow: 'engine:create-workflow',
    CreateWorkflowResult: 'engine:create-workflow-result',
    UpdateWorkflow: 'engine:update-workflow',
    UpdateWorkflowResult: 'engine:update-workflow-result',
    DeleteWorkflow: 'engine:delete-workflow',
    DeleteWorkflowResult: 'engine:delete-workflow-result',
    GetWorkflow: 'engine:get-workflow',
    GetWorkflowResult: 'engine:get-workflow-result',
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
export type EngineCreateWorkflow = {
    type: typeof EngineChannel.CreateWorkflow;
    name: string;
    pipeline: CompiledPipeline;
};
export type EngineCreateWorkflowResult = {
    type: typeof EngineChannel.CreateWorkflowResult;
    correlationId: string;
    summary: WorkflowSummary;
};
export type EngineUpdateWorkflow = {
    type: typeof EngineChannel.UpdateWorkflow;
    id: string;
    name: string;
    pipeline: CompiledPipeline;
};
export type EngineUpdateWorkflowResult = {
    type: typeof EngineChannel.UpdateWorkflowResult;
    correlationId: string;
    summary: WorkflowSummary;
};
export type EngineDeleteWorkflow = {
    type: typeof EngineChannel.DeleteWorkflow;
    id: string;
};
export type EngineDeleteWorkflowResult = {
    type: typeof EngineChannel.DeleteWorkflowResult;
    correlationId: string;
    success: boolean;
};
export type EngineGetWorkflow = {
    type: typeof EngineChannel.GetWorkflow;
    id: string;
    correlationId: string;
};
export type EngineGetWorkflowResultFound = {
    type: typeof EngineChannel.GetWorkflowResult;
    correlationId: string;
    found: true;
    name: string;
    pipeline: CompiledPipeline;
};
export type EngineGetWorkflowResultNotFound = {
    type: typeof EngineChannel.GetWorkflowResult;
    correlationId: string;
    found: false;
    error: string;
};
export type EngineGetWorkflowResult =
    | EngineGetWorkflowResultFound
    | EngineGetWorkflowResultNotFound;

export type EngineMessage =
    | EnginePing
    | EnginePong
    | EngineFireTestEvent
    | EngineLog
    | EngineWorkflowsList
    | EngineToggleWorkflow
    | EngineCreateWorkflow
    | EngineCreateWorkflowResult
    | EngineUpdateWorkflow
    | EngineUpdateWorkflowResult
    | EngineDeleteWorkflow
    | EngineDeleteWorkflowResult
    | EngineGetWorkflow
    | EngineGetWorkflowResult;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
    FireTestEvent: 'renderer:fire-test-event',
    EngineLog: 'renderer:engine-log',
    WorkflowsList: 'renderer:workflows-list',
    ToggleWorkflow: 'renderer:toggle-workflow',
    CreateWorkflow: 'renderer:create-workflow',
    UpdateWorkflow: 'renderer:update-workflow',
    DeleteWorkflow: 'renderer:delete-workflow',
    GetWorkflow: 'renderer:get-workflow',
} as const;
