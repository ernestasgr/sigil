import type { Capability } from '@sigil/schema/manifest';

import type { CompiledPipeline } from '@sigil/schema';

import type { NodePosition, WorkflowSummary } from './workflow.js';
import type { PluginInfo } from './plugin-info.js';

export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    Log: 'engine:log',
    WorkflowsList: 'engine:workflows-list',
    ToggleWorkflow: 'engine:toggle-workflow',
    ToggleWorkflowResult: 'engine:toggle-workflow-result',
    CreateWorkflow: 'engine:create-workflow',
    CreateWorkflowResult: 'engine:create-workflow-result',
    UpdateWorkflow: 'engine:update-workflow',
    UpdateWorkflowResult: 'engine:update-workflow-result',
    DeleteWorkflow: 'engine:delete-workflow',
    DeleteWorkflowResult: 'engine:delete-workflow-result',
    GetWorkflow: 'engine:get-workflow',
    GetWorkflowResult: 'engine:get-workflow-result',
    BusEvent: 'engine:bus-event',
    ListPlugins: 'engine:list-plugins',
    ListPluginsResult: 'engine:list-plugins-result',
    SetPermissionOverride: 'engine:set-permission-override',
    SetPermissionOverrideResult: 'engine:set-permission-override-result',
    ReadProperties: 'engine:read-properties',
    ReadPropertiesResult: 'engine:read-properties-result',
    SaveProperties: 'engine:save-properties',
    SavePropertiesResult: 'engine:save-properties-result',
    FireManualTrigger: 'engine:fire-manual-trigger',
    ReadWorkflowState: 'engine:read-workflow-state',
    ReadWorkflowStateResult: 'engine:read-workflow-state-result',
    SetWorkflowStateKey: 'engine:set-workflow-state-key',
    SetWorkflowStateKeyResult: 'engine:set-workflow-state-key-result',
    DeleteWorkflowStateKey: 'engine:delete-workflow-state-key',
    DeleteWorkflowStateKeyResult: 'engine:delete-workflow-state-key-result',
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
    correlationId: string;
    id: string;
};
export type EngineToggleWorkflowResult = {
    type: typeof EngineChannel.ToggleWorkflowResult;
    correlationId: string;
    summary: WorkflowSummary | null;
};
export type EngineCreateWorkflow = {
    type: typeof EngineChannel.CreateWorkflow;
    correlationId: string;
    name: string;
    pipeline: CompiledPipeline;
    positions: Readonly<Record<string, NodePosition>>;
};
export type EngineCreateWorkflowResult = {
    type: typeof EngineChannel.CreateWorkflowResult;
    correlationId: string;
    summary: WorkflowSummary;
};
export type EngineUpdateWorkflow = {
    type: typeof EngineChannel.UpdateWorkflow;
    correlationId: string;
    id: string;
    name: string;
    pipeline: CompiledPipeline;
    positions: Readonly<Record<string, NodePosition>>;
};
export type EngineUpdateWorkflowResult = {
    type: typeof EngineChannel.UpdateWorkflowResult;
    correlationId: string;
    summary: WorkflowSummary;
};
export type EngineDeleteWorkflow = {
    type: typeof EngineChannel.DeleteWorkflow;
    correlationId: string;
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
    positions: Readonly<Record<string, NodePosition>>;
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

export interface EngineBusEventPayload {
    readonly name: string;
    readonly payload: unknown;
}

export type EngineBusEvent = {
    type: typeof EngineChannel.BusEvent;
    event: EngineBusEventPayload;
};

export type EngineListPlugins = {
    type: typeof EngineChannel.ListPlugins;
    correlationId: string;
};
export type EngineListPluginsResult = {
    type: typeof EngineChannel.ListPluginsResult;
    correlationId: string;
    plugins: readonly PluginInfo[];
};

export type EngineSetPermissionOverride = {
    type: typeof EngineChannel.SetPermissionOverride;
    correlationId: string;
    pluginId: string;
    overrides: readonly Capability[];
};
export type EngineSetPermissionOverrideResult = {
    type: typeof EngineChannel.SetPermissionOverrideResult;
    correlationId: string;
    ok: boolean;
};

export type EngineReadProperties = {
    type: typeof EngineChannel.ReadProperties;
    correlationId: string;
};
export type EngineReadPropertiesResult = {
    type: typeof EngineChannel.ReadPropertiesResult;
    correlationId: string;
    properties: Record<string, unknown>;
};

export type EngineSaveProperties = {
    type: typeof EngineChannel.SaveProperties;
    correlationId: string;
    properties: Record<string, unknown>;
};
export type EngineSavePropertiesResult = {
    type: typeof EngineChannel.SavePropertiesResult;
    correlationId: string;
    ok: boolean;
};

export type EngineFireManualTrigger = {
    type: typeof EngineChannel.FireManualTrigger;
    pipeline: CompiledPipeline;
};

export interface WorkflowStateEntry {
    readonly key: string;
    readonly value: string;
}

export type EngineReadWorkflowState = {
    type: typeof EngineChannel.ReadWorkflowState;
    correlationId: string;
    workflowId: string;
};
export type EngineReadWorkflowStateResult = {
    type: typeof EngineChannel.ReadWorkflowStateResult;
    correlationId: string;
    entries: readonly WorkflowStateEntry[];
};
export type EngineSetWorkflowStateKey = {
    type: typeof EngineChannel.SetWorkflowStateKey;
    correlationId: string;
    workflowId: string;
    key: string;
    value: string;
};
export type EngineSetWorkflowStateKeyResult = {
    type: typeof EngineChannel.SetWorkflowStateKeyResult;
    correlationId: string;
    ok: boolean;
};
export type EngineDeleteWorkflowStateKey = {
    type: typeof EngineChannel.DeleteWorkflowStateKey;
    correlationId: string;
    workflowId: string;
    key: string;
};
export type EngineDeleteWorkflowStateKeyResult = {
    type: typeof EngineChannel.DeleteWorkflowStateKeyResult;
    correlationId: string;
    ok: boolean;
};

export type EngineMessage =
    | EnginePing
    | EnginePong
    | EngineFireTestEvent
    | EngineLog
    | EngineWorkflowsList
    | EngineToggleWorkflow
    | EngineToggleWorkflowResult
    | EngineCreateWorkflow
    | EngineCreateWorkflowResult
    | EngineUpdateWorkflow
    | EngineUpdateWorkflowResult
    | EngineDeleteWorkflow
    | EngineDeleteWorkflowResult
    | EngineGetWorkflow
    | EngineGetWorkflowResult
    | EngineBusEvent
    | EngineListPlugins
    | EngineListPluginsResult
    | EngineSetPermissionOverride
    | EngineSetPermissionOverrideResult
    | EngineReadProperties
    | EngineReadPropertiesResult
    | EngineSaveProperties
    | EngineSavePropertiesResult
    | EngineFireManualTrigger
    | EngineReadWorkflowState
    | EngineReadWorkflowStateResult
    | EngineSetWorkflowStateKey
    | EngineSetWorkflowStateKeyResult
    | EngineDeleteWorkflowStateKey
    | EngineDeleteWorkflowStateKeyResult;

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
    BusEvent: 'renderer:bus-event',
    RendererReady: 'renderer:renderer-ready',
    ListPlugins: 'renderer:list-plugins',
    SetPermissionOverride: 'renderer:set-permission-override',
    ReadProperties: 'renderer:read-properties',
    SaveProperties: 'renderer:save-properties',
    OpenFileDialog: 'renderer:open-file-dialog',
    FireManualTrigger: 'renderer:fire-manual-trigger',
    ReadWorkflowState: 'renderer:read-workflow-state',
    SetWorkflowStateKey: 'renderer:set-workflow-state-key',
    DeleteWorkflowStateKey: 'renderer:delete-workflow-state-key',
} as const;
