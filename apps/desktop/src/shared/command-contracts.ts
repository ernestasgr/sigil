import { CompiledPipelineSchema } from '@sigil/schema';
import { FileEventPayloadSchema } from '@sigil/schema/file-event-payload';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { z } from 'zod';

import {
    EngineChannel,
    EngineCreateWorkflowResultSchema,
    EngineCreateWorkflowSchema,
    EngineDeleteWorkflowResultSchema,
    EngineDeleteWorkflowSchema,
    EngineDeleteWorkflowStateKeyResultSchema,
    EngineDeleteWorkflowStateKeySchema,
    EngineFireManualTriggerResultSchema,
    EngineFireManualTriggerSchema,
    EngineFireTestEventResultSchema,
    EngineFireTestEventSchema,
    EngineGetWorkflowResultSchema,
    EngineGetWorkflowSchema,
    EngineListPluginsResultSchema,
    EngineListPluginsSchema,
    EnginePingSchema,
    EnginePongSchema,
    EngineReadPropertiesResultSchema,
    EngineReadPropertiesSchema,
    EngineReadWorkflowStateResultSchema,
    EngineReadWorkflowStateSchema,
    EngineReadySchema,
    EngineRetryWorkflowResultSchema,
    EngineRetryWorkflowSchema,
    EngineSavePropertiesResultSchema,
    EngineSavePropertiesSchema,
    EngineSetPermissionOverrideResultSchema,
    EngineSetPermissionOverrideSchema,
    EngineSetWorkflowStateKeyResultSchema,
    EngineSetWorkflowStateKeySchema,
    EngineShutdownResultSchema,
    EngineShutdownSchema,
    EngineToggleWorkflowResultSchema,
    EngineToggleWorkflowSchema,
    EngineToMainMessageOrReadySchema,
    EngineToMainMessageSchema,
    EngineUpdateWorkflowResultSchema,
    EngineUpdateWorkflowSchema,
    MainToEngineMessageSchema,
    NodePositionRecordSchema,
    PluginInfoSchema,
    RendererChannel,
    WorkflowActionOutcomeSchema,
    WorkflowDeleteOutcomeSchema,
    WorkflowIdSchema,
    WorkflowStateEntrySchema,
    WorkflowWriteOutcomeSchema,
} from './ipc-channels.js';
import { PersistenceWriteOutcomeSchema } from './persistence.js';

export { CommandCorrelationIdSchema, CorrelationIdSchema } from './ipc-channels.js';
export { EngineToMainMessageSchema, MainToEngineMessageSchema };

export const CommandFailureSchema = z
    .object({
        ok: z.literal(false),
        code: z.enum([
            'timeout',
            'worker-error',
            'worker-exit',
            'invalid-response',
            'unexpected-response',
        ]),
        error: z.string(),
    })
    .readonly();
export type CommandFailure = z.infer<typeof CommandFailureSchema>;

export const CommandExecutionOutcomeSchema = z
    .union([
        z.object({ ok: z.literal(true) }).readonly(),
        z.object({ ok: z.literal(false), error: z.string() }).readonly(),
    ])
    .readonly();
export type CommandExecutionOutcome = z.infer<typeof CommandExecutionOutcomeSchema>;

const RendererGetWorkflowResponseSchema = z.union([
    z
        .object({
            name: z.string(),
            pipeline: CompiledPipelineSchema,
            positions: NodePositionRecordSchema,
        })
        .readonly(),
    z.null(),
]);

const engineCommands = {
    ping: {
        direction: 'main-to-engine',
        command: EngineChannel.Ping,
        responseType: EngineChannel.Pong,
        requestSchema: EnginePingSchema,
        responseSchema: EnginePongSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    fireTestEvent: {
        direction: 'main-to-engine',
        command: EngineChannel.FireTestEvent,
        responseType: EngineChannel.FireTestEventResult,
        requestSchema: EngineFireTestEventSchema,
        responseSchema: EngineFireTestEventResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    toggleWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.ToggleWorkflow,
        responseType: EngineChannel.ToggleWorkflowResult,
        requestSchema: EngineToggleWorkflowSchema,
        responseSchema: EngineToggleWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    retryWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.RetryWorkflow,
        responseType: EngineChannel.RetryWorkflowResult,
        requestSchema: EngineRetryWorkflowSchema,
        responseSchema: EngineRetryWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    createWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.CreateWorkflow,
        responseType: EngineChannel.CreateWorkflowResult,
        requestSchema: EngineCreateWorkflowSchema,
        responseSchema: EngineCreateWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    updateWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.UpdateWorkflow,
        responseType: EngineChannel.UpdateWorkflowResult,
        requestSchema: EngineUpdateWorkflowSchema,
        responseSchema: EngineUpdateWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    deleteWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.DeleteWorkflow,
        responseType: EngineChannel.DeleteWorkflowResult,
        requestSchema: EngineDeleteWorkflowSchema,
        responseSchema: EngineDeleteWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    getWorkflow: {
        direction: 'main-to-engine',
        command: EngineChannel.GetWorkflow,
        responseType: EngineChannel.GetWorkflowResult,
        requestSchema: EngineGetWorkflowSchema,
        responseSchema: EngineGetWorkflowResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    listPlugins: {
        direction: 'main-to-engine',
        command: EngineChannel.ListPlugins,
        responseType: EngineChannel.ListPluginsResult,
        requestSchema: EngineListPluginsSchema,
        responseSchema: EngineListPluginsResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    setPermissionOverride: {
        direction: 'main-to-engine',
        command: EngineChannel.SetPermissionOverride,
        responseType: EngineChannel.SetPermissionOverrideResult,
        requestSchema: EngineSetPermissionOverrideSchema,
        responseSchema: EngineSetPermissionOverrideResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    readProperties: {
        direction: 'main-to-engine',
        command: EngineChannel.ReadProperties,
        responseType: EngineChannel.ReadPropertiesResult,
        requestSchema: EngineReadPropertiesSchema,
        responseSchema: EngineReadPropertiesResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    saveProperties: {
        direction: 'main-to-engine',
        command: EngineChannel.SaveProperties,
        responseType: EngineChannel.SavePropertiesResult,
        requestSchema: EngineSavePropertiesSchema,
        responseSchema: EngineSavePropertiesResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    fireManualTrigger: {
        direction: 'main-to-engine',
        command: EngineChannel.FireManualTrigger,
        responseType: EngineChannel.FireManualTriggerResult,
        requestSchema: EngineFireManualTriggerSchema,
        responseSchema: EngineFireManualTriggerResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    readWorkflowState: {
        direction: 'main-to-engine',
        command: EngineChannel.ReadWorkflowState,
        responseType: EngineChannel.ReadWorkflowStateResult,
        requestSchema: EngineReadWorkflowStateSchema,
        responseSchema: EngineReadWorkflowStateResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    setWorkflowStateKey: {
        direction: 'main-to-engine',
        command: EngineChannel.SetWorkflowStateKey,
        responseType: EngineChannel.SetWorkflowStateKeyResult,
        requestSchema: EngineSetWorkflowStateKeySchema,
        responseSchema: EngineSetWorkflowStateKeyResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    deleteWorkflowStateKey: {
        direction: 'main-to-engine',
        command: EngineChannel.DeleteWorkflowStateKey,
        responseType: EngineChannel.DeleteWorkflowStateKeyResult,
        requestSchema: EngineDeleteWorkflowStateKeySchema,
        responseSchema: EngineDeleteWorkflowStateKeyResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 5_000,
        correlation: 'correlationId',
    },
    shutdown: {
        direction: 'main-to-engine',
        command: EngineChannel.Shutdown,
        responseType: EngineChannel.ShutdownResult,
        requestSchema: EngineShutdownSchema,
        responseSchema: EngineShutdownResultSchema,
        failureSchema: CommandFailureSchema,
        timeoutMs: 30_000,
        correlation: 'correlationId',
    },
} as const;

export const EngineCommandContracts = engineCommands;
export type EngineCommandName = keyof typeof EngineCommandContracts;
export type EngineCommandContract<C extends EngineCommandName = EngineCommandName> =
    (typeof EngineCommandContracts)[C];
export type EngineRequest<C extends EngineCommandName> = z.output<
    (typeof EngineCommandContracts)[C]['requestSchema']
>;
export type EngineResponse<C extends EngineCommandName> = z.output<
    (typeof EngineCommandContracts)[C]['responseSchema']
>;
export type EngineRequestPayload<C extends EngineCommandName> = Omit<
    EngineRequest<C>,
    'type' | 'correlationId'
>;
export type EngineCommandRequest = {
    [C in EngineCommandName]: EngineRequest<C>;
}[EngineCommandName];
export type EngineCommandResponse = {
    [C in EngineCommandName]: EngineResponse<C>;
}[EngineCommandName];

export { EngineReadySchema, EngineToMainMessageOrReadySchema };

const rendererCommands = {
    rendererReady: {
        direction: 'renderer-to-main',
        channel: RendererChannel.RendererReady,
        requestSchema: z.undefined(),
        responseSchema: z.undefined(),
    },
    pingEngine: {
        direction: 'renderer-to-main',
        channel: RendererChannel.EnginePong,
        requestSchema: z.undefined(),
        responseSchema: z.union([EnginePongSchema, z.null()]),
    },
    fireTestEvent: {
        direction: 'renderer-to-main',
        channel: RendererChannel.FireTestEvent,
        requestSchema: z.undefined(),
        responseSchema: CommandExecutionOutcomeSchema,
    },
    toggleWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.ToggleWorkflow,
        requestSchema: WorkflowIdSchema,
        responseSchema: WorkflowActionOutcomeSchema,
    },
    retryWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.RetryWorkflow,
        requestSchema: WorkflowIdSchema,
        responseSchema: WorkflowActionOutcomeSchema,
    },
    createWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.CreateWorkflow,
        requestSchema: z.tuple([z.string(), CompiledPipelineSchema, NodePositionRecordSchema]),
        responseSchema: WorkflowWriteOutcomeSchema,
    },
    updateWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.UpdateWorkflow,
        requestSchema: z
            .tuple([WorkflowIdSchema, z.string(), CompiledPipelineSchema, NodePositionRecordSchema])
            .superRefine(([workflowId, , pipeline], ctx) => {
                if (workflowId !== pipeline.workflowId) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [2, 'workflowId'],
                        message: 'Pipeline workflowId must match the requested Workflow id.',
                    });
                }
            }),
        responseSchema: WorkflowWriteOutcomeSchema,
    },
    deleteWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.DeleteWorkflow,
        requestSchema: WorkflowIdSchema,
        responseSchema: WorkflowDeleteOutcomeSchema,
    },
    getWorkflow: {
        direction: 'renderer-to-main',
        channel: RendererChannel.GetWorkflow,
        requestSchema: WorkflowIdSchema,
        responseSchema: RendererGetWorkflowResponseSchema,
    },
    listPlugins: {
        direction: 'renderer-to-main',
        channel: RendererChannel.ListPlugins,
        requestSchema: z.undefined(),
        responseSchema: z.array(PluginInfoSchema).readonly(),
    },
    setPermissionOverride: {
        direction: 'renderer-to-main',
        channel: RendererChannel.SetPermissionOverride,
        requestSchema: z.tuple([z.string(), z.array(CapabilitySchema).readonly()]),
        responseSchema: PersistenceWriteOutcomeSchema,
    },
    readProperties: {
        direction: 'renderer-to-main',
        channel: RendererChannel.ReadProperties,
        requestSchema: z.undefined(),
        responseSchema: z.union([
            z.record(z.string(), z.unknown()).readonly(),
            z
                .object({
                    properties: z.record(z.string(), z.unknown()).readonly(),
                    defaults: z.record(z.string(), z.unknown()).readonly().optional(),
                })
                .readonly(),
        ]),
    },
    saveProperties: {
        direction: 'renderer-to-main',
        channel: RendererChannel.SaveProperties,
        requestSchema: z.record(z.string(), z.unknown()).readonly(),
        responseSchema: PersistenceWriteOutcomeSchema,
    },
    openFileDialog: {
        direction: 'renderer-to-main',
        channel: RendererChannel.OpenFileDialog,
        requestSchema: z.undefined(),
        responseSchema: FileEventPayloadSchema.nullable(),
    },
    fireManualTrigger: {
        direction: 'renderer-to-main',
        channel: RendererChannel.FireManualTrigger,
        requestSchema: CompiledPipelineSchema,
        responseSchema: CommandExecutionOutcomeSchema,
    },
    readWorkflowState: {
        direction: 'renderer-to-main',
        channel: RendererChannel.ReadWorkflowState,
        requestSchema: WorkflowIdSchema,
        responseSchema: z.array(WorkflowStateEntrySchema).readonly(),
    },
    setWorkflowStateKey: {
        direction: 'renderer-to-main',
        channel: RendererChannel.SetWorkflowStateKey,
        requestSchema: z.tuple([WorkflowIdSchema, z.string(), z.string()]),
        responseSchema: z.boolean(),
    },
    deleteWorkflowStateKey: {
        direction: 'renderer-to-main',
        channel: RendererChannel.DeleteWorkflowStateKey,
        requestSchema: z.tuple([WorkflowIdSchema, z.string()]),
        responseSchema: z.boolean(),
    },
} as const;

export const RendererCommandContracts = rendererCommands;
export type RendererCommandName = keyof typeof RendererCommandContracts;
export type RendererCommandContract<C extends RendererCommandName = RendererCommandName> =
    (typeof RendererCommandContracts)[C];
export type RendererRequest<C extends RendererCommandName> = z.output<
    (typeof RendererCommandContracts)[C]['requestSchema']
>;
export type RendererResponse<C extends RendererCommandName> = z.output<
    (typeof RendererCommandContracts)[C]['responseSchema']
>;
export type RendererCommandArguments<C extends RendererCommandName> =
    RendererRequest<C> extends readonly unknown[]
        ? RendererRequest<C>
        : RendererRequest<C> extends undefined
          ? []
          : [RendererRequest<C>];
export type RendererCommandMethod<C extends RendererCommandName> = (
    ...args: RendererCommandArguments<C>
) => Promise<RendererResponse<C>>;
export type RendererCommandMethods = {
    readonly [C in RendererCommandName]: RendererCommandMethod<C>;
};

export const CommandContracts = {
    rendererReady: { renderer: rendererCommands.rendererReady },
    pingEngine: { renderer: rendererCommands.pingEngine, engine: engineCommands.ping },
    fireTestEvent: {
        renderer: rendererCommands.fireTestEvent,
        engine: engineCommands.fireTestEvent,
    },
    toggleWorkflow: {
        renderer: rendererCommands.toggleWorkflow,
        engine: engineCommands.toggleWorkflow,
    },
    retryWorkflow: {
        renderer: rendererCommands.retryWorkflow,
        engine: engineCommands.retryWorkflow,
    },
    createWorkflow: {
        renderer: rendererCommands.createWorkflow,
        engine: engineCommands.createWorkflow,
    },
    updateWorkflow: {
        renderer: rendererCommands.updateWorkflow,
        engine: engineCommands.updateWorkflow,
    },
    deleteWorkflow: {
        renderer: rendererCommands.deleteWorkflow,
        engine: engineCommands.deleteWorkflow,
    },
    getWorkflow: {
        renderer: rendererCommands.getWorkflow,
        engine: engineCommands.getWorkflow,
    },
    listPlugins: {
        renderer: rendererCommands.listPlugins,
        engine: engineCommands.listPlugins,
    },
    setPermissionOverride: {
        renderer: rendererCommands.setPermissionOverride,
        engine: engineCommands.setPermissionOverride,
    },
    readProperties: {
        renderer: rendererCommands.readProperties,
        engine: engineCommands.readProperties,
    },
    saveProperties: {
        renderer: rendererCommands.saveProperties,
        engine: engineCommands.saveProperties,
    },
    openFileDialog: { renderer: rendererCommands.openFileDialog },
    fireManualTrigger: {
        renderer: rendererCommands.fireManualTrigger,
        engine: engineCommands.fireManualTrigger,
    },
    readWorkflowState: {
        renderer: rendererCommands.readWorkflowState,
        engine: engineCommands.readWorkflowState,
    },
    setWorkflowStateKey: {
        renderer: rendererCommands.setWorkflowStateKey,
        engine: engineCommands.setWorkflowStateKey,
    },
    deleteWorkflowStateKey: {
        renderer: rendererCommands.deleteWorkflowStateKey,
        engine: engineCommands.deleteWorkflowStateKey,
    },
    shutdown: { engine: engineCommands.shutdown },
} as const;

export type CommandName = keyof typeof CommandContracts;
export type CommandContract = (typeof CommandContracts)[CommandName];
