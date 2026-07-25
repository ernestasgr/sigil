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
} from './ipc-channels.js';

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
