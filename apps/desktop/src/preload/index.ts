import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';

const api = {
    pingEngine: (): Promise<EnginePong | null> => ipcRenderer.invoke(RendererChannel.EnginePong),
    fireTestEvent: (): Promise<void> => ipcRenderer.invoke(RendererChannel.FireTestEvent),
    onEngineLog: (handler: (line: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, line: string): void => handler(line);
        ipcRenderer.on(RendererChannel.EngineLog, listener);
        return () => {
            ipcRenderer.off(RendererChannel.EngineLog, listener);
        };
    },
};

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
