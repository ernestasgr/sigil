import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import {
    type CommandExecutionOutcome,
    RendererCommandContracts,
    type RendererCommandName,
    type RendererRequest,
    type RendererResponse,
} from '../shared/command-contracts.js';
import {
    PersistenceDiagnosticSchema,
    type PersistenceWriteOutcome,
} from '../shared/persistence.js';
import type { EngineHandle } from './engine-client.js';
import { ipcHandle } from './ipc-handle.js';

export interface IpcHandlerContext {
    readonly getEngine: () => EngineHandle | null;
    readonly getMainWindow: () => BrowserWindow | null;
    readonly onRendererReady: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function persistenceFailure(error: unknown, fallbackPath: string): PersistenceWriteOutcome {
    const record = isRecord(error) ? error : undefined;
    const diagnostics = record?.diagnostics;
    if (Array.isArray(diagnostics)) {
        const diagnostic = diagnostics
            .map((candidate) => PersistenceDiagnosticSchema.safeParse(candidate))
            .find((result) => result.success);
        if (diagnostic?.success) {
            return {
                ok: false,
                error: errorMessage(error),
                diagnostic: diagnostic.data,
            };
        }
    }

    const message = errorMessage(error);
    return {
        ok: false,
        error: message,
        diagnostic: {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: fallbackPath,
            message,
        },
    };
}

function workflowFailure(error: unknown): RendererResponse<'createWorkflow'> {
    return {
        ok: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function workflowActionFailure(error: unknown): RendererResponse<'toggleWorkflow'> {
    return {
        ok: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function workflowDeleteFailure(error: unknown): RendererResponse<'deleteWorkflow'> {
    return {
        ok: false,
        success: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function executionFailure(error: unknown): CommandExecutionOutcome {
    return { ok: false, error: errorMessage(error) };
}

export function registerIpcHandlers(ctx: IpcHandlerContext): void {
    const h = ctx;
    const renderer = RendererCommandContracts;

    ipcHandle(renderer.rendererReady.channel, renderer.rendererReady.requestSchema, async () => {
        h.onRendererReady();
    });

    ipcHandle(
        renderer.pingEngine.channel,
        renderer.pingEngine.requestSchema,
        async (): Promise<RendererResponse<'pingEngine'>> => {
            const engine = h.getEngine();
            if (!engine) return null;
            try {
                return await engine.ping();
            } catch (err) {
                console.error('[main] engine ping failed:', err);
                return null;
            }
        },
    );

    ipcHandle(
        renderer.fireTestEvent.channel,
        renderer.fireTestEvent.requestSchema,
        async (): Promise<RendererResponse<'fireTestEvent'>> => {
            const engine = h.getEngine();
            if (!engine) return executionFailure(new Error('Engine not ready'));
            try {
                return await engine.fireTestEvent();
            } catch (err) {
                console.error('[main] fireTestEvent failed:', err);
                return executionFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.toggleWorkflow.channel,
        renderer.toggleWorkflow.requestSchema,
        async (
            id: RendererRequest<'toggleWorkflow'>,
        ): Promise<RendererResponse<'toggleWorkflow'>> => {
            const engine = h.getEngine();
            if (!engine) return workflowActionFailure(new Error('Engine not ready'));
            try {
                return await engine.toggleWorkflow(id);
            } catch (err) {
                console.error('[main] toggleWorkflow failed:', err);
                return workflowActionFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.retryWorkflow.channel,
        renderer.retryWorkflow.requestSchema,
        async (
            id: RendererRequest<'retryWorkflow'>,
        ): Promise<RendererResponse<'retryWorkflow'>> => {
            const engine = h.getEngine();
            if (!engine) return workflowActionFailure(new Error('Engine not ready'));
            try {
                return await engine.retryWorkflow(id);
            } catch (err) {
                console.error('[main] retryWorkflow failed:', err);
                return workflowActionFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.createWorkflow.channel,
        renderer.createWorkflow.requestSchema,
        async ([name, pipeline, positions]: RendererRequest<'createWorkflow'>): Promise<
            RendererResponse<'createWorkflow'>
        > => {
            const engine = h.getEngine();
            if (!engine) return workflowFailure(new Error('Engine not ready'));
            try {
                return await engine.createWorkflow(name, pipeline, positions);
            } catch (err) {
                console.error('[main] createWorkflow failed:', err);
                return workflowFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.updateWorkflow.channel,
        renderer.updateWorkflow.requestSchema,
        async ([id, name, pipeline, positions]: RendererRequest<'updateWorkflow'>): Promise<
            RendererResponse<'updateWorkflow'>
        > => {
            const engine = h.getEngine();
            if (!engine) return workflowFailure(new Error('Engine not ready'));
            try {
                return await engine.updateWorkflow(id, name, pipeline, positions);
            } catch (err) {
                console.error('[main] updateWorkflow failed:', err);
                return workflowFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.deleteWorkflow.channel,
        renderer.deleteWorkflow.requestSchema,
        async (
            id: RendererRequest<'deleteWorkflow'>,
        ): Promise<RendererResponse<'deleteWorkflow'>> => {
            const engine = h.getEngine();
            if (!engine) return workflowDeleteFailure(new Error('Engine not ready'));
            try {
                return await engine.deleteWorkflow(id);
            } catch (err) {
                console.error('[main] deleteWorkflow failed:', err);
                return workflowDeleteFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.getWorkflow.channel,
        renderer.getWorkflow.requestSchema,
        async (id: RendererRequest<'getWorkflow'>): Promise<RendererResponse<'getWorkflow'>> => {
            const engine = h.getEngine();
            if (!engine) return null;
            try {
                const result = await engine.getWorkflow(id);
                if (result.found) {
                    return {
                        name: result.name,
                        pipeline: result.pipeline,
                        positions: result.positions,
                    };
                }
                return null;
            } catch (err) {
                console.error('[main] getWorkflow failed:', err);
                return null;
            }
        },
    );

    ipcHandle(
        renderer.listPlugins.channel,
        renderer.listPlugins.requestSchema,
        async (): Promise<RendererResponse<'listPlugins'>> => {
            const engine = h.getEngine();
            if (!engine) return [];
            try {
                return await engine.listPlugins();
            } catch (err) {
                console.error('[main] listPlugins failed:', err);
                return [];
            }
        },
    );

    ipcHandle(
        renderer.setPermissionOverride.channel,
        renderer.setPermissionOverride.requestSchema,
        async ([pluginId, overrides]: RendererRequest<'setPermissionOverride'>): Promise<
            RendererResponse<'setPermissionOverride'>
        > => {
            const engine = h.getEngine();
            if (!engine) return persistenceFailure(new Error('Engine not ready'), 'engine');
            try {
                return await engine.setPermissionOverride(pluginId, overrides);
            } catch (err) {
                console.error('[main] setPermissionOverride failed:', err);
                return persistenceFailure(err, 'permission-overrides.json');
            }
        },
    );

    ipcHandle(
        renderer.readProperties.channel,
        renderer.readProperties.requestSchema,
        async (): Promise<RendererResponse<'readProperties'>> => {
            const engine = h.getEngine();
            if (!engine) return {};
            try {
                return await engine.readProperties();
            } catch (err) {
                console.error('[main] readProperties failed:', err);
                return {};
            }
        },
    );

    ipcHandle(
        renderer.saveProperties.channel,
        renderer.saveProperties.requestSchema,
        async (
            properties: RendererRequest<'saveProperties'>,
        ): Promise<RendererResponse<'saveProperties'>> => {
            const engine = h.getEngine();
            if (!engine) return persistenceFailure(new Error('Engine not ready'), 'engine');
            try {
                return await engine.saveProperties(properties);
            } catch (err) {
                console.error('[main] saveProperties failed:', err);
                return persistenceFailure(err, 'sigil.properties.json');
            }
        },
    );

    ipcHandle(
        renderer.openFileDialog.channel,
        renderer.openFileDialog.requestSchema,
        async (): Promise<RendererResponse<'openFileDialog'>> => {
            const mainWindow = h.getMainWindow();
            if (!mainWindow) return null;
            try {
                const result = await dialog.showOpenDialog(mainWindow, {
                    properties: ['openFile'],
                });
                if (result.canceled || result.filePaths.length === 0) return null;
                const filePath = result.filePaths[0];
                if (!filePath) return null;
                const stats = await stat(filePath);
                return {
                    path: filePath,
                    name: basename(filePath),
                    ext: extname(filePath).replace('.', ''),
                    size: stats.size,
                    dir: dirname(filePath),
                };
            } catch (err) {
                console.error('[main] openFileDialog failed:', err);
                return null;
            }
        },
    );

    ipcHandle(
        renderer.fireManualTrigger.channel,
        renderer.fireManualTrigger.requestSchema,
        async (
            pipeline: RendererRequest<'fireManualTrigger'>,
        ): Promise<RendererResponse<'fireManualTrigger'>> => {
            const engine = h.getEngine();
            if (!engine) return executionFailure(new Error('Engine not ready'));
            try {
                return await engine.fireManualTrigger(pipeline);
            } catch (err) {
                console.error('[main] fireManualTrigger failed:', err);
                return executionFailure(err);
            }
        },
    );

    ipcHandle(
        renderer.readWorkflowState.channel,
        renderer.readWorkflowState.requestSchema,
        async (
            workflowId: RendererRequest<'readWorkflowState'>,
        ): Promise<RendererResponse<'readWorkflowState'>> => {
            const engine = h.getEngine();
            if (!engine) return [];
            try {
                return await engine.readWorkflowState(workflowId);
            } catch (err) {
                console.error('[main] readWorkflowState failed:', err);
                return [];
            }
        },
    );

    ipcHandle(
        renderer.setWorkflowStateKey.channel,
        renderer.setWorkflowStateKey.requestSchema,
        async ([workflowId, key, value]: RendererRequest<'setWorkflowStateKey'>): Promise<
            RendererResponse<'setWorkflowStateKey'>
        > => {
            const engine = h.getEngine();
            if (!engine) return false;
            try {
                return await engine.setWorkflowStateKey(workflowId, key, value);
            } catch (err) {
                console.error('[main] setWorkflowStateKey failed:', err);
                return false;
            }
        },
    );

    ipcHandle(
        renderer.deleteWorkflowStateKey.channel,
        renderer.deleteWorkflowStateKey.requestSchema,
        async ([workflowId, key]: RendererRequest<'deleteWorkflowStateKey'>): Promise<
            RendererResponse<'deleteWorkflowStateKey'>
        > => {
            const engine = h.getEngine();
            if (!engine) return false;
            try {
                return await engine.deleteWorkflowStateKey(workflowId, key);
            } catch (err) {
                console.error('[main] deleteWorkflowStateKey failed:', err);
                return false;
            }
        },
    );

    type InvokeChannel = (typeof RendererCommandContracts)[RendererCommandName]['channel'];

    void ({
        [renderer.rendererReady.channel]: true,
        [renderer.pingEngine.channel]: true,
        [renderer.fireTestEvent.channel]: true,
        [renderer.toggleWorkflow.channel]: true,
        [renderer.retryWorkflow.channel]: true,
        [renderer.createWorkflow.channel]: true,
        [renderer.updateWorkflow.channel]: true,
        [renderer.deleteWorkflow.channel]: true,
        [renderer.getWorkflow.channel]: true,
        [renderer.listPlugins.channel]: true,
        [renderer.setPermissionOverride.channel]: true,
        [renderer.readProperties.channel]: true,
        [renderer.saveProperties.channel]: true,
        [renderer.openFileDialog.channel]: true,
        [renderer.fireManualTrigger.channel]: true,
        [renderer.readWorkflowState.channel]: true,
        [renderer.setWorkflowStateKey.channel]: true,
        [renderer.deleteWorkflowStateKey.channel]: true,
    } satisfies Record<InvokeChannel, true>);
}
