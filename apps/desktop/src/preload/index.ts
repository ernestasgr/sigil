import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';

const api = {
    pingEngine: (): Promise<EnginePong | null> => ipcRenderer.invoke(RendererChannel.EnginePong),
    fireTestEvent: (): Promise<void> => ipcRenderer.invoke(RendererChannel.FireTestEvent),
    enableWorkflows: (): Promise<void> => ipcRenderer.invoke(RendererChannel.EnableWorkflows),
    disableWorkflows: (): Promise<void> => ipcRenderer.invoke(RendererChannel.DisableWorkflows),
    onEngineLog: (handler: (line: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, line: string): void => handler(line);
        ipcRenderer.on(RendererChannel.EngineLog, listener);
        return () => {
            ipcRenderer.off(RendererChannel.EngineLog, listener);
        };
    },
    onWorkflowsActive: (handler: (active: boolean) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, active: boolean): void => handler(active);
        ipcRenderer.on(RendererChannel.WorkflowsActive, listener);
        return () => {
            ipcRenderer.off(RendererChannel.WorkflowsActive, listener);
        };
    },
};

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
