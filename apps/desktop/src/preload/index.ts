import { contextBridge, ipcRenderer } from 'electron';
import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';

const api = {
    pingEngine: (): Promise<EnginePong | null> => ipcRenderer.invoke(RendererChannel.EnginePong),
};

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
