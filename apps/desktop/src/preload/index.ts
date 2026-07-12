import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import {
    RendererCommandContracts,
    type RendererRequest,
    type RendererResponse,
} from '../shared/command-contracts.js';
import { type EngineBusEventPayload, RendererChannel } from '../shared/ipc-channels.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const api = {
    rendererReady: (): Promise<RendererResponse<'rendererReady'>> =>
        ipcRenderer.invoke(RendererCommandContracts.rendererReady.channel),
    pingEngine: (): Promise<RendererResponse<'pingEngine'>> =>
        ipcRenderer.invoke(RendererCommandContracts.pingEngine.channel),
    fireTestEvent: (): Promise<RendererResponse<'fireTestEvent'>> =>
        ipcRenderer.invoke(RendererCommandContracts.fireTestEvent.channel),
    toggleWorkflow: (
        id: RendererRequest<'toggleWorkflow'>,
    ): Promise<RendererResponse<'toggleWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.toggleWorkflow.channel, id),
    retryWorkflow: (
        id: RendererRequest<'retryWorkflow'>,
    ): Promise<RendererResponse<'retryWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.retryWorkflow.channel, id),
    createWorkflow: (
        ...args: RendererRequest<'createWorkflow'>
    ): Promise<RendererResponse<'createWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.createWorkflow.channel, ...args),
    updateWorkflow: (
        ...args: RendererRequest<'updateWorkflow'>
    ): Promise<RendererResponse<'updateWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.updateWorkflow.channel, ...args),
    deleteWorkflow: (
        id: RendererRequest<'deleteWorkflow'>,
    ): Promise<RendererResponse<'deleteWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.deleteWorkflow.channel, id),
    getWorkflow: (id: RendererRequest<'getWorkflow'>): Promise<RendererResponse<'getWorkflow'>> =>
        ipcRenderer.invoke(RendererCommandContracts.getWorkflow.channel, id),
    listPlugins: (): Promise<RendererResponse<'listPlugins'>> =>
        ipcRenderer.invoke(RendererCommandContracts.listPlugins.channel),
    setPermissionOverride: (
        ...args: RendererRequest<'setPermissionOverride'>
    ): Promise<RendererResponse<'setPermissionOverride'>> =>
        ipcRenderer.invoke(RendererCommandContracts.setPermissionOverride.channel, ...args),
    readProperties: (): Promise<RendererResponse<'readProperties'>> =>
        ipcRenderer.invoke(RendererCommandContracts.readProperties.channel),
    saveProperties: (
        properties: RendererRequest<'saveProperties'>,
    ): Promise<RendererResponse<'saveProperties'>> =>
        ipcRenderer.invoke(RendererCommandContracts.saveProperties.channel, properties),
    openFileDialog: (): Promise<RendererResponse<'openFileDialog'>> =>
        ipcRenderer.invoke(RendererCommandContracts.openFileDialog.channel),
    fireManualTrigger: (
        pipeline: RendererRequest<'fireManualTrigger'>,
    ): Promise<RendererResponse<'fireManualTrigger'>> =>
        ipcRenderer.invoke(RendererCommandContracts.fireManualTrigger.channel, pipeline),
    readWorkflowState: (
        workflowId: RendererRequest<'readWorkflowState'>,
    ): Promise<RendererResponse<'readWorkflowState'>> =>
        ipcRenderer.invoke(RendererCommandContracts.readWorkflowState.channel, workflowId),
    setWorkflowStateKey: (
        ...args: RendererRequest<'setWorkflowStateKey'>
    ): Promise<RendererResponse<'setWorkflowStateKey'>> =>
        ipcRenderer.invoke(RendererCommandContracts.setWorkflowStateKey.channel, ...args),
    deleteWorkflowStateKey: (
        ...args: RendererRequest<'deleteWorkflowStateKey'>
    ): Promise<RendererResponse<'deleteWorkflowStateKey'>> =>
        ipcRenderer.invoke(RendererCommandContracts.deleteWorkflowStateKey.channel, ...args),
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
