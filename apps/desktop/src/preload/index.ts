import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
    type RendererCommandArguments,
    RendererCommandContracts,
    type RendererCommandMethods,
    type RendererCommandName,
    type RendererResponse,
} from '../shared/command-contracts.js';
import {
    type EngineBusEventPayload,
    EngineBusEventPayloadSchema,
    RendererChannel,
} from '../shared/ipc-channels.js';
import type { WorkflowSummary } from '../shared/workflow.js';
import { WorkflowSummarySchema } from '../shared/workflow.js';

type RendererEventMethods = {
    readonly onEngineLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
    readonly onBusEvent: (handler: (event: EngineBusEventPayload) => void) => () => void;
};

function reportInvalidPushPayload(channel: string, payload: unknown): void {
    console.error(`[preload] invalid ${channel} payload`, payload);
}

async function invokeRendererCommand<C extends RendererCommandName>(
    command: C,
    ...args: RendererCommandArguments<C>
): Promise<RendererResponse<C>> {
    const contract = RendererCommandContracts[command];
    const raw: unknown = await ipcRenderer.invoke(contract.channel, ...args);
    const parsed = contract.responseSchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new Error(`Invalid response for ${command}: ${detail}`);
    }
    // The schema is selected from the same command key as the return type; Zod
    // cannot preserve that indexed relationship through safeParse's result.
    return parsed.data as RendererResponse<C>;
}

const api = {
    rendererReady: (...args: RendererCommandArguments<'rendererReady'>) =>
        invokeRendererCommand('rendererReady', ...args),
    pingEngine: (...args: RendererCommandArguments<'pingEngine'>) =>
        invokeRendererCommand('pingEngine', ...args),
    fireTestEvent: (...args: RendererCommandArguments<'fireTestEvent'>) =>
        invokeRendererCommand('fireTestEvent', ...args),
    toggleWorkflow: (...args: RendererCommandArguments<'toggleWorkflow'>) =>
        invokeRendererCommand('toggleWorkflow', ...args),
    retryWorkflow: (...args: RendererCommandArguments<'retryWorkflow'>) =>
        invokeRendererCommand('retryWorkflow', ...args),
    createWorkflow: (...args: RendererCommandArguments<'createWorkflow'>) =>
        invokeRendererCommand('createWorkflow', ...args),
    updateWorkflow: (...args: RendererCommandArguments<'updateWorkflow'>) =>
        invokeRendererCommand('updateWorkflow', ...args),
    deleteWorkflow: (...args: RendererCommandArguments<'deleteWorkflow'>) =>
        invokeRendererCommand('deleteWorkflow', ...args),
    getWorkflow: (...args: RendererCommandArguments<'getWorkflow'>) =>
        invokeRendererCommand('getWorkflow', ...args),
    listPlugins: (...args: RendererCommandArguments<'listPlugins'>) =>
        invokeRendererCommand('listPlugins', ...args),
    setPermissionOverride: (...args: RendererCommandArguments<'setPermissionOverride'>) =>
        invokeRendererCommand('setPermissionOverride', ...args),
    readProperties: (...args: RendererCommandArguments<'readProperties'>) =>
        invokeRendererCommand('readProperties', ...args),
    saveProperties: (...args: RendererCommandArguments<'saveProperties'>) =>
        invokeRendererCommand('saveProperties', ...args),
    openFileDialog: (...args: RendererCommandArguments<'openFileDialog'>) =>
        invokeRendererCommand('openFileDialog', ...args),
    fireManualTrigger: (...args: RendererCommandArguments<'fireManualTrigger'>) =>
        invokeRendererCommand('fireManualTrigger', ...args),
    readWorkflowState: (...args: RendererCommandArguments<'readWorkflowState'>) =>
        invokeRendererCommand('readWorkflowState', ...args),
    setWorkflowStateKey: (...args: RendererCommandArguments<'setWorkflowStateKey'>) =>
        invokeRendererCommand('setWorkflowStateKey', ...args),
    deleteWorkflowStateKey: (...args: RendererCommandArguments<'deleteWorkflowStateKey'>) =>
        invokeRendererCommand('deleteWorkflowStateKey', ...args),
    onEngineLog: (handler: (line: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, raw: unknown): void => {
            const parsed = z.string().safeParse(raw);
            if (!parsed.success) {
                reportInvalidPushPayload(RendererChannel.EngineLog, raw);
                return;
            }
            handler(parsed.data);
        };
        ipcRenderer.on(RendererChannel.EngineLog, listener);
        return () => {
            ipcRenderer.off(RendererChannel.EngineLog, listener);
        };
    },
    onWorkflowsList: (handler: (workflows: readonly WorkflowSummary[]) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, raw: unknown): void => {
            const parsed = z.array(WorkflowSummarySchema).readonly().safeParse(raw);
            if (!parsed.success) {
                reportInvalidPushPayload(RendererChannel.WorkflowsList, raw);
                return;
            }
            handler(parsed.data);
        };
        ipcRenderer.on(RendererChannel.WorkflowsList, listener);
        return () => {
            ipcRenderer.off(RendererChannel.WorkflowsList, listener);
        };
    },
    onBusEvent: (handler: (event: EngineBusEventPayload) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, raw: unknown): void => {
            const parsed = EngineBusEventPayloadSchema.safeParse(raw);
            if (!parsed.success) {
                reportInvalidPushPayload(RendererChannel.BusEvent, raw);
                return;
            }
            handler(parsed.data);
        };
        ipcRenderer.on(RendererChannel.BusEvent, listener);
        return () => {
            ipcRenderer.off(RendererChannel.BusEvent, listener);
        };
    },
} satisfies RendererCommandMethods & RendererEventMethods;

contextBridge.exposeInMainWorld('sigil', api);

export type SigilRendererAPI = typeof api;
