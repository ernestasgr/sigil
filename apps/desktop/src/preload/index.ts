import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';
import type { WorkflowSummary } from '../shared/workflow.js';

const api = {
    pingEngine: (): Promise<EnginePong | null> => ipcRenderer.invoke(RendererChannel.EnginePong),
    fireTestEvent: (): Promise<void> => ipcRenderer.invoke(RendererChannel.FireTestEvent),
    toggleWorkflow: (id: string): Promise<void> =>
        ipcRenderer.invoke(RendererChannel.ToggleWorkflow, id),
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
};

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
