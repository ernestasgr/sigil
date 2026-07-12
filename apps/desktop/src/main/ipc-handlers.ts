import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { CompiledPipelineSchema } from '@sigil/schema';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { Option } from 'effect';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { z } from 'zod';
import type { WorkflowStateEntry } from '../shared/ipc-channels.js';
import {
    type EnginePong,
    NodePositionRecordSchema,
    RendererChannel,
    WorkflowIdSchema,
} from '../shared/ipc-channels.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import type { WorkflowSummary } from '../shared/workflow.js';
import type { EngineHandle } from './engine-client.js';
import { ipcHandle } from './ipc-handle.js';

export interface IpcHandlerContext {
    readonly getEngine: () => EngineHandle | null;
    readonly getMainWindow: () => BrowserWindow | null;
    readonly onRendererReady: () => void;
}

const UpdateWorkflowArgsSchema = z
    .tuple([WorkflowIdSchema, z.string(), CompiledPipelineSchema, NodePositionRecordSchema])
    .superRefine(([workflowId, , pipeline], ctx) => {
        if (workflowId !== pipeline.workflowId) {
            ctx.addIssue({
                code: 'custom',
                path: [2, 'workflowId'],
                message: 'Pipeline workflowId must match the requested Workflow id.',
            });
        }
    });

const SetWorkflowStateKeyArgsSchema = z.tuple([WorkflowIdSchema, z.string(), z.string()]);
const DeleteWorkflowStateKeyArgsSchema = z.tuple([WorkflowIdSchema, z.string()]);

export function registerIpcHandlers(ctx: IpcHandlerContext): void {
    const h = ctx;

    ipcHandle(RendererChannel.RendererReady, z.undefined(), async () => {
        h.onRendererReady();
    });

    ipcHandle(RendererChannel.EnginePong, z.undefined(), async (): Promise<EnginePong | null> => {
        const engine = h.getEngine();
        if (!engine) return null;
        try {
            return await engine.ping();
        } catch (err) {
            console.error('[main] engine ping failed:', err);
            return null;
        }
    });

    ipcHandle(RendererChannel.FireTestEvent, z.undefined(), async () => {
        h.getEngine()?.fireTestEvent();
    });

    ipcHandle(
        RendererChannel.ToggleWorkflow,
        WorkflowIdSchema,
        async (id): Promise<WorkflowSummary | null> => {
            const engine = h.getEngine();
            if (!engine) throw new Error('Engine not ready');
            return Option.getOrNull(await engine.toggleWorkflow(id));
        },
    );

    ipcHandle(
        RendererChannel.RetryWorkflow,
        WorkflowIdSchema,
        async (id): Promise<WorkflowSummary | null> => {
            const engine = h.getEngine();
            if (!engine) throw new Error('Engine not ready');
            return Option.getOrNull(await engine.retryWorkflow(id));
        },
    );

    ipcHandle(
        RendererChannel.CreateWorkflow,
        z.tuple([z.string(), CompiledPipelineSchema, NodePositionRecordSchema]),
        async ([name, pipeline, positions]): Promise<WorkflowSummary> => {
            const engine = h.getEngine();
            if (!engine) throw new Error('Engine not ready');
            return await engine.createWorkflow(name, pipeline, positions);
        },
    );

    ipcHandle(
        RendererChannel.UpdateWorkflow,
        UpdateWorkflowArgsSchema,
        async ([id, name, pipeline, positions]): Promise<WorkflowSummary> => {
            const engine = h.getEngine();
            if (!engine) throw new Error('Engine not ready');
            return await engine.updateWorkflow(id, name, pipeline, positions);
        },
    );

    ipcHandle(RendererChannel.DeleteWorkflow, WorkflowIdSchema, async (id): Promise<boolean> => {
        const engine = h.getEngine();
        if (!engine) throw new Error('Engine not ready');
        return await engine.deleteWorkflow(id);
    });

    ipcHandle(
        RendererChannel.GetWorkflow,
        WorkflowIdSchema,
        async (
            id,
        ): Promise<{
            readonly name: string;
            readonly pipeline: import('@sigil/schema').CompiledPipeline;
            readonly positions: Readonly<
                Record<string, { readonly x: number; readonly y: number }>
            >;
        } | null> => {
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
        RendererChannel.ListPlugins,
        z.undefined(),
        async (): Promise<readonly PluginInfo[]> => {
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
        RendererChannel.SetPermissionOverride,
        z.tuple([z.string(), z.array(CapabilitySchema)]),
        async ([pluginId, overrides]): Promise<boolean> => {
            const engine = h.getEngine();
            if (!engine) return false;
            try {
                return await engine.setPermissionOverride(pluginId, overrides);
            } catch (err) {
                console.error('[main] setPermissionOverride failed:', err);
                return false;
            }
        },
    );

    ipcHandle(
        RendererChannel.ReadProperties,
        z.undefined(),
        async (): Promise<Record<string, unknown>> => {
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
        RendererChannel.SaveProperties,
        z.record(z.string(), z.unknown()),
        async (properties): Promise<boolean> => {
            const engine = h.getEngine();
            if (!engine) return false;
            try {
                return await engine.saveProperties(properties);
            } catch (err) {
                console.error('[main] saveProperties failed:', err);
                return false;
            }
        },
    );

    ipcHandle(
        RendererChannel.OpenFileDialog,
        z.undefined(),
        async (): Promise<FileEventPayload | null> => {
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
        RendererChannel.FireManualTrigger,
        CompiledPipelineSchema,
        async (pipeline): Promise<void> => {
            const engine = h.getEngine();
            if (!engine) throw new Error('Engine not ready');
            engine.fireManualTrigger(pipeline);
        },
    );

    ipcHandle(
        RendererChannel.ReadWorkflowState,
        WorkflowIdSchema,
        async (workflowId): Promise<readonly WorkflowStateEntry[]> => {
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
        RendererChannel.SetWorkflowStateKey,
        SetWorkflowStateKeyArgsSchema,
        async ([workflowId, key, value]): Promise<boolean> => {
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
        RendererChannel.DeleteWorkflowStateKey,
        DeleteWorkflowStateKeyArgsSchema,
        async ([workflowId, key]): Promise<boolean> => {
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

    // Exhaustiveness check: all invoke channels must have a handler registered above.
    // Push-only channels (EngineLog, WorkflowsList, BusEvent) are excluded.
    type PushChannel =
        | typeof RendererChannel.EngineLog
        | typeof RendererChannel.WorkflowsList
        | typeof RendererChannel.BusEvent;

    type InvokeChannel = Exclude<
        (typeof RendererChannel)[keyof typeof RendererChannel],
        PushChannel
    >;

    void ({
        [RendererChannel.RendererReady]: true,
        [RendererChannel.EnginePong]: true,
        [RendererChannel.FireTestEvent]: true,
        [RendererChannel.ToggleWorkflow]: true,
        [RendererChannel.RetryWorkflow]: true,
        [RendererChannel.CreateWorkflow]: true,
        [RendererChannel.UpdateWorkflow]: true,
        [RendererChannel.DeleteWorkflow]: true,
        [RendererChannel.GetWorkflow]: true,
        [RendererChannel.ListPlugins]: true,
        [RendererChannel.SetPermissionOverride]: true,
        [RendererChannel.ReadProperties]: true,
        [RendererChannel.SaveProperties]: true,
        [RendererChannel.OpenFileDialog]: true,
        [RendererChannel.FireManualTrigger]: true,
        [RendererChannel.ReadWorkflowState]: true,
        [RendererChannel.SetWorkflowStateKey]: true,
        [RendererChannel.DeleteWorkflowStateKey]: true,
    } satisfies Record<InvokeChannel, true>);
}
