import type { CompiledPipeline } from '@sigil/schema';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { Capability } from '@sigil/schema/manifest';
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { WorkflowStateEntry } from '../shared/ipc-channels.js';
import {
    type EngineBusEventPayload,
    type EnginePong,
    RendererChannel,
    type WorkflowActionOutcome,
    type WorkflowDeleteOutcome,
    type WorkflowWriteOutcome,
} from '../shared/ipc-channels.js';
import type { PersistenceWriteOutcome } from '../shared/persistence.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { NodePosition, WorkflowSummary } from '../shared/workflow.js';

const api = {
    rendererReady: (): Promise<void> => ipcRenderer.invoke(RendererChannel.RendererReady),
    pingEngine: (): Promise<EnginePong | null> => ipcRenderer.invoke(RendererChannel.EnginePong),
    fireTestEvent: (): Promise<void> => ipcRenderer.invoke(RendererChannel.FireTestEvent),
    toggleWorkflow: (id: string): Promise<WorkflowActionOutcome> =>
        ipcRenderer.invoke(RendererChannel.ToggleWorkflow, id),
    retryWorkflow: (id: string): Promise<WorkflowActionOutcome> =>
        ipcRenderer.invoke(RendererChannel.RetryWorkflow, id),
    createWorkflow: (
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, NodePosition>>,
    ): Promise<WorkflowWriteOutcome> =>
        ipcRenderer.invoke(RendererChannel.CreateWorkflow, name, pipeline, positions),
    updateWorkflow: (
        id: string,
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, NodePosition>>,
    ): Promise<WorkflowWriteOutcome> =>
        ipcRenderer.invoke(RendererChannel.UpdateWorkflow, id, name, pipeline, positions),
    deleteWorkflow: (id: string): Promise<WorkflowDeleteOutcome> =>
        ipcRenderer.invoke(RendererChannel.DeleteWorkflow, id),
    getWorkflow: (
        id: string,
    ): Promise<{
        readonly name: string;
        readonly pipeline: CompiledPipeline;
        readonly positions: Readonly<Record<string, NodePosition>>;
    } | null> => ipcRenderer.invoke(RendererChannel.GetWorkflow, id),
    listPlugins: (): Promise<readonly PluginInfo[]> =>
        ipcRenderer.invoke(RendererChannel.ListPlugins),
    setPermissionOverride: (
        pluginId: string,
        overrides: readonly Capability[],
    ): Promise<PersistenceWriteOutcome> =>
        ipcRenderer.invoke(RendererChannel.SetPermissionOverride, pluginId, overrides),
    readProperties: (): Promise<Record<string, unknown>> =>
        ipcRenderer.invoke(RendererChannel.ReadProperties),
    saveProperties: (properties: Record<string, unknown>): Promise<PersistenceWriteOutcome> =>
        ipcRenderer.invoke(RendererChannel.SaveProperties, properties),
    openFileDialog: (): Promise<FileEventPayload | null> =>
        ipcRenderer.invoke(RendererChannel.OpenFileDialog),
    fireManualTrigger: (pipeline: CompiledPipeline): Promise<void> =>
        ipcRenderer.invoke(RendererChannel.FireManualTrigger, pipeline),
    readWorkflowState: (workflowId: string): Promise<readonly WorkflowStateEntry[]> =>
        ipcRenderer.invoke(RendererChannel.ReadWorkflowState, workflowId),
    setWorkflowStateKey: (workflowId: string, key: string, value: string): Promise<boolean> =>
        ipcRenderer.invoke(RendererChannel.SetWorkflowStateKey, workflowId, key, value),
    deleteWorkflowStateKey: (workflowId: string, key: string): Promise<boolean> =>
        ipcRenderer.invoke(RendererChannel.DeleteWorkflowStateKey, workflowId, key),
    onEngineLog: (handler: (line: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, line: string): void => handler(line);
        ipcRenderer.on(RendererChannel.EngineLog, listener);
        return () => {
            ipcRenderer.off(RendererChannel.EngineLog, listener);
        };
    },
    onWorkflowsList: (handler: (workflows: readonly WorkflowSummary[]) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, workflows: WorkflowSummary[]): void =>
            handler(workflows);
        ipcRenderer.on(RendererChannel.WorkflowsList, listener);
        return () => {
            ipcRenderer.off(RendererChannel.WorkflowsList, listener);
        };
    },
    onBusEvent: (handler: (event: EngineBusEventPayload) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, event: EngineBusEventPayload): void =>
            handler(event);
        ipcRenderer.on(RendererChannel.BusEvent, listener);
        return () => {
            ipcRenderer.off(RendererChannel.BusEvent, listener);
        };
    },
};

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
