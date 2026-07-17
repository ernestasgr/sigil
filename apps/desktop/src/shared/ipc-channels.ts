import { CompiledPipelineSchema } from '@sigil/schema';
import { CapabilitySchema, ManifestSchema } from '@sigil/schema/manifest';
import { TopologyDiagnosticSchema } from '@sigil/schema/topology';
import { z } from 'zod';
import { PersistenceDiagnosticSchema } from './persistence.js';
import { EventTelemetrySchema } from './telemetry.js';
import { WorkflowIdSchema, WorkflowSummarySchema } from './workflow.js';

export type { PersistenceDiagnostic } from './persistence.js';
export { PersistenceDiagnosticSchema } from './persistence.js';
export { WorkflowIdSchema } from './workflow.js';

const WorkflowWriteDiagnosticSchema = z.union([
    TopologyDiagnosticSchema,
    PersistenceDiagnosticSchema,
]);
export type WorkflowWriteDiagnostic = z.infer<typeof WorkflowWriteDiagnosticSchema>;

export const WorkflowWriteOutcomeSchema = z.union([
    z
        .object({
            ok: z.literal(true),
            summary: WorkflowSummarySchema,
        })
        .readonly(),
    z
        .object({
            ok: z.literal(false),
            error: z.string(),
            diagnostics: z.array(WorkflowWriteDiagnosticSchema).readonly(),
        })
        .readonly(),
]);
export type WorkflowWriteOutcome = z.infer<typeof WorkflowWriteOutcomeSchema>;

export const WorkflowActionOutcomeSchema = z.union([
    z
        .object({
            ok: z.literal(true),
            summary: WorkflowSummarySchema.nullable(),
        })
        .strict()
        .readonly(),
    z
        .object({
            ok: z.literal(false),
            error: z.string(),
            diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
        })
        .strict()
        .readonly(),
]);
export type WorkflowActionOutcome = z.infer<typeof WorkflowActionOutcomeSchema>;

export const WorkflowDeleteOutcomeSchema = z.union([
    z
        .object({
            ok: z.literal(true),
            success: z.boolean(),
        })
        .strict()
        .readonly(),
    z
        .object({
            ok: z.literal(false),
            success: z.literal(false),
            error: z.string(),
            diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
        })
        .strict()
        .readonly(),
]);
export type WorkflowDeleteOutcome = z.infer<typeof WorkflowDeleteOutcomeSchema>;

const NodePositionSchema = z.object({ x: z.number(), y: z.number() }).readonly();
export const NodePositionRecordSchema = z.record(z.string(), NodePositionSchema).readonly();

const WorkflowStateStringValueSchema = z
    .object({
        type: z.literal('string'),
        value: z.string(),
    })
    .readonly();
const WorkflowStateNumberValueSchema = z
    .object({
        type: z.literal('number'),
        value: z.number().finite(),
    })
    .readonly();
const WorkflowStateBooleanValueSchema = z
    .object({
        type: z.literal('boolean'),
        value: z.boolean(),
    })
    .readonly();

export const WorkflowStateValueSchema = z.discriminatedUnion('type', [
    WorkflowStateStringValueSchema,
    WorkflowStateNumberValueSchema,
    WorkflowStateBooleanValueSchema,
]);
export type WorkflowStateValue = z.infer<typeof WorkflowStateValueSchema>;
export type WorkflowStatePrimitive = WorkflowStateValue['value'];
export type WorkflowStateValueType = WorkflowStateValue['type'];
export const WorkflowStatePrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const WorkflowStateEntrySchema = z.discriminatedUnion('type', [
    z
        .object({
            key: z.string(),
            type: z.literal('string'),
            value: z.string(),
        })
        .readonly(),
    z
        .object({
            key: z.string(),
            type: z.literal('number'),
            value: z.number().finite(),
        })
        .readonly(),
    z
        .object({
            key: z.string(),
            type: z.literal('boolean'),
            value: z.boolean(),
        })
        .readonly(),
]);

export { WorkflowStateEntrySchema };
export type WorkflowStateEntry = z.infer<typeof WorkflowStateEntrySchema>;

export const CorrelationIdSchema = z
    .string()
    .min(1, 'Correlation id must not be empty.')
    .max(128, 'Correlation id must be at most 128 characters.')
    .readonly();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
export const CommandCorrelationIdSchema = CorrelationIdSchema;
export type CommandCorrelationId = CorrelationId;

const EngineBusEventPayloadSchema = z
    .object({
        name: z.string(),
        payload: z.unknown(),
        timestamp: z.number().finite().nonnegative().optional(),
        telemetry: EventTelemetrySchema.optional(),
    })
    .readonly();
export type EngineBusEventPayload = z.infer<typeof EngineBusEventPayloadSchema>;

const PluginInfoSchema = z
    .object({
        manifest: ManifestSchema,
        grantedPermissions: z.array(CapabilitySchema).readonly(),
    })
    .readonly();

export { PluginInfoSchema };

export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    FireTestEventResult: 'engine:fire-test-event-result',
    Log: 'engine:log',
    WorkflowsList: 'engine:workflows-list',
    ToggleWorkflow: 'engine:toggle-workflow',
    ToggleWorkflowResult: 'engine:toggle-workflow-result',
    RetryWorkflow: 'engine:retry-workflow',
    RetryWorkflowResult: 'engine:retry-workflow-result',
    CreateWorkflow: 'engine:create-workflow',
    CreateWorkflowResult: 'engine:create-workflow-result',
    UpdateWorkflow: 'engine:update-workflow',
    UpdateWorkflowResult: 'engine:update-workflow-result',
    DeleteWorkflow: 'engine:delete-workflow',
    DeleteWorkflowResult: 'engine:delete-workflow-result',
    GetWorkflow: 'engine:get-workflow',
    GetWorkflowResult: 'engine:get-workflow-result',
    BusEvent: 'engine:bus-event',
    ListPlugins: 'engine:list-plugins',
    ListPluginsResult: 'engine:list-plugins-result',
    SetPermissionOverride: 'engine:set-permission-override',
    SetPermissionOverrideResult: 'engine:set-permission-override-result',
    ReadProperties: 'engine:read-properties',
    ReadPropertiesResult: 'engine:read-properties-result',
    SaveProperties: 'engine:save-properties',
    SavePropertiesResult: 'engine:save-properties-result',
    FireManualTrigger: 'engine:fire-manual-trigger',
    FireManualTriggerResult: 'engine:fire-manual-trigger-result',
    ReadWorkflowState: 'engine:read-workflow-state',
    ReadWorkflowStateResult: 'engine:read-workflow-state-result',
    SetWorkflowStateKey: 'engine:set-workflow-state-key',
    SetWorkflowStateKeyResult: 'engine:set-workflow-state-key-result',
    DeleteWorkflowStateKey: 'engine:delete-workflow-state-key',
    DeleteWorkflowStateKeyResult: 'engine:delete-workflow-state-key-result',
    Shutdown: 'engine:shutdown',
    ShutdownResult: 'engine:shutdown-result',
} as const;

export const EnginePingSchema = z.object({
    correlationId: CorrelationIdSchema,
    type: z.literal(EngineChannel.Ping),
});
export type EnginePing = z.infer<typeof EnginePingSchema>;
export const EnginePongSchema = z.object({
    correlationId: CorrelationIdSchema,
    type: z.literal(EngineChannel.Pong),
    receivedAt: z.number(),
});
export type EnginePong = z.infer<typeof EnginePongSchema>;

export const EngineFireTestEventSchema = z.object({
    correlationId: CorrelationIdSchema,
    type: z.literal(EngineChannel.FireTestEvent),
});
export type EngineFireTestEvent = z.infer<typeof EngineFireTestEventSchema>;

const EngineFireTestEventSuccessSchema = z
    .object({
        correlationId: CorrelationIdSchema,
        type: z.literal(EngineChannel.FireTestEventResult),
        ok: z.literal(true),
    })
    .strict();
const EngineFireTestEventFailureSchema = z
    .object({
        correlationId: CorrelationIdSchema,
        type: z.literal(EngineChannel.FireTestEventResult),
        ok: z.literal(false),
        error: z.string(),
    })
    .strict();
export const EngineFireTestEventResultSchema = z.union([
    EngineFireTestEventSuccessSchema,
    EngineFireTestEventFailureSchema,
]);
export type EngineFireTestEventResult = z.infer<typeof EngineFireTestEventResultSchema>;

export const EngineLogSchema = z.object({
    type: z.literal(EngineChannel.Log),
    line: z.string(),
});
export type EngineLog = z.infer<typeof EngineLogSchema>;

export const EngineWorkflowsListSchema = z.object({
    type: z.literal(EngineChannel.WorkflowsList),
    workflows: z.array(WorkflowSummarySchema).readonly(),
});
export type EngineWorkflowsList = z.infer<typeof EngineWorkflowsListSchema>;

export const EngineToggleWorkflowSchema = z.object({
    type: z.literal(EngineChannel.ToggleWorkflow),
    correlationId: CorrelationIdSchema,
    id: WorkflowIdSchema,
});
export type EngineToggleWorkflow = z.infer<typeof EngineToggleWorkflowSchema>;

const EngineToggleWorkflowSuccessSchema = z
    .object({
        type: z.literal(EngineChannel.ToggleWorkflowResult),
        correlationId: CorrelationIdSchema,
        summary: WorkflowSummarySchema.nullable(),
    })
    .strict();
const EngineToggleWorkflowFailureSchema = z
    .object({
        type: z.literal(EngineChannel.ToggleWorkflowResult),
        correlationId: CorrelationIdSchema,
        summary: z.null(),
        error: z.string(),
        diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
    })
    .strict();
export const EngineToggleWorkflowResultSchema = z.union([
    EngineToggleWorkflowFailureSchema,
    EngineToggleWorkflowSuccessSchema,
]);
export type EngineToggleWorkflowResult = z.infer<typeof EngineToggleWorkflowResultSchema>;

export const EngineRetryWorkflowSchema = z.object({
    type: z.literal(EngineChannel.RetryWorkflow),
    correlationId: CorrelationIdSchema,
    id: WorkflowIdSchema,
});
export type EngineRetryWorkflow = z.infer<typeof EngineRetryWorkflowSchema>;

const EngineRetryWorkflowSuccessSchema = z
    .object({
        type: z.literal(EngineChannel.RetryWorkflowResult),
        correlationId: CorrelationIdSchema,
        summary: WorkflowSummarySchema.nullable(),
    })
    .strict();
const EngineRetryWorkflowFailureSchema = z
    .object({
        type: z.literal(EngineChannel.RetryWorkflowResult),
        correlationId: CorrelationIdSchema,
        summary: z.null(),
        error: z.string(),
        diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
    })
    .strict();
export const EngineRetryWorkflowResultSchema = z.union([
    EngineRetryWorkflowFailureSchema,
    EngineRetryWorkflowSuccessSchema,
]);
export type EngineRetryWorkflowResult = z.infer<typeof EngineRetryWorkflowResultSchema>;

export const EngineCreateWorkflowSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflow),
    correlationId: CorrelationIdSchema,
    name: z.string(),
    pipeline: CompiledPipelineSchema,
    positions: NodePositionRecordSchema,
});
export type EngineCreateWorkflow = z.infer<typeof EngineCreateWorkflowSchema>;

const EngineCreateWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflowResult),
    correlationId: CorrelationIdSchema,
    summary: WorkflowSummarySchema,
});
const EngineCreateWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflowResult),
    correlationId: CorrelationIdSchema,
    error: z.string(),
    diagnostics: z.array(WorkflowWriteDiagnosticSchema).readonly(),
});
export const EngineCreateWorkflowResultSchema = z.union([
    EngineCreateWorkflowSuccessSchema,
    EngineCreateWorkflowFailureSchema,
]);
export type EngineCreateWorkflowResult = z.infer<typeof EngineCreateWorkflowResultSchema>;

export const EngineUpdateWorkflowSchema = z
    .object({
        type: z.literal(EngineChannel.UpdateWorkflow),
        correlationId: CorrelationIdSchema,
        id: WorkflowIdSchema,
        name: z.string(),
        pipeline: CompiledPipelineSchema,
        positions: NodePositionRecordSchema,
    })
    .superRefine((message, ctx) => {
        if (message.id !== message.pipeline.workflowId) {
            ctx.addIssue({
                code: 'custom',
                path: ['pipeline', 'workflowId'],
                message: 'Pipeline workflowId must match the requested Workflow id.',
            });
        }
    });
export type EngineUpdateWorkflow = z.infer<typeof EngineUpdateWorkflowSchema>;

const EngineUpdateWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.UpdateWorkflowResult),
    correlationId: CorrelationIdSchema,
    summary: WorkflowSummarySchema,
});
const EngineUpdateWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.UpdateWorkflowResult),
    correlationId: CorrelationIdSchema,
    error: z.string(),
    diagnostics: z.array(WorkflowWriteDiagnosticSchema).readonly(),
});
export const EngineUpdateWorkflowResultSchema = z.union([
    EngineUpdateWorkflowSuccessSchema,
    EngineUpdateWorkflowFailureSchema,
]);
export type EngineUpdateWorkflowResult = z.infer<typeof EngineUpdateWorkflowResultSchema>;

export const EngineDeleteWorkflowSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflow),
    correlationId: CorrelationIdSchema,
    id: WorkflowIdSchema,
});
export type EngineDeleteWorkflow = z.infer<typeof EngineDeleteWorkflowSchema>;

const EngineDeleteWorkflowSuccessSchema = z
    .object({
        type: z.literal(EngineChannel.DeleteWorkflowResult),
        correlationId: CorrelationIdSchema,
        success: z.literal(true),
    })
    .strict();
const EngineDeleteWorkflowNotFoundSchema = z
    .object({
        type: z.literal(EngineChannel.DeleteWorkflowResult),
        correlationId: CorrelationIdSchema,
        success: z.literal(false),
    })
    .strict();
const EngineDeleteWorkflowFailureSchema = z
    .object({
        type: z.literal(EngineChannel.DeleteWorkflowResult),
        correlationId: CorrelationIdSchema,
        success: z.literal(false),
        error: z.string(),
        diagnostic: PersistenceDiagnosticSchema,
    })
    .strict();
export const EngineDeleteWorkflowResultSchema = z.union([
    EngineDeleteWorkflowFailureSchema,
    EngineDeleteWorkflowSuccessSchema,
    EngineDeleteWorkflowNotFoundSchema,
]);
export type EngineDeleteWorkflowResult = z.infer<typeof EngineDeleteWorkflowResultSchema>;

export const EngineGetWorkflowSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflow),
    id: WorkflowIdSchema,
    correlationId: CorrelationIdSchema,
});
export type EngineGetWorkflow = z.infer<typeof EngineGetWorkflowSchema>;

export const EngineGetWorkflowResultFoundSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflowResult),
    correlationId: CorrelationIdSchema,
    found: z.literal(true),
    name: z.string(),
    pipeline: CompiledPipelineSchema,
    positions: NodePositionRecordSchema,
});
export type EngineGetWorkflowResultFound = z.infer<typeof EngineGetWorkflowResultFoundSchema>;

export const EngineGetWorkflowResultNotFoundSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflowResult),
    correlationId: CorrelationIdSchema,
    found: z.literal(false),
    error: z.string(),
});
export type EngineGetWorkflowResultNotFound = z.infer<typeof EngineGetWorkflowResultNotFoundSchema>;

export const EngineGetWorkflowResultSchema = z.discriminatedUnion('found', [
    EngineGetWorkflowResultFoundSchema,
    EngineGetWorkflowResultNotFoundSchema,
]);
export type EngineGetWorkflowResult = z.infer<typeof EngineGetWorkflowResultSchema>;

export const EngineBusEventSchema = z.object({
    type: z.literal(EngineChannel.BusEvent),
    event: EngineBusEventPayloadSchema,
});
export type EngineBusEvent = z.infer<typeof EngineBusEventSchema>;

export const EngineListPluginsSchema = z.object({
    type: z.literal(EngineChannel.ListPlugins),
    correlationId: CorrelationIdSchema,
});
export type EngineListPlugins = z.infer<typeof EngineListPluginsSchema>;

export const EngineListPluginsResultSchema = z.object({
    type: z.literal(EngineChannel.ListPluginsResult),
    correlationId: CorrelationIdSchema,
    plugins: z.array(PluginInfoSchema).readonly(),
});
export type EngineListPluginsResult = z.infer<typeof EngineListPluginsResultSchema>;

export const EngineSetPermissionOverrideSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverride),
    correlationId: CorrelationIdSchema,
    pluginId: z.string(),
    overrides: z.array(CapabilitySchema).readonly(),
});
export type EngineSetPermissionOverride = z.infer<typeof EngineSetPermissionOverrideSchema>;

const EngineSetPermissionOverrideSuccessSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverrideResult),
    correlationId: CorrelationIdSchema,
    ok: z.literal(true),
});
const EngineSetPermissionOverrideFailureSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverrideResult),
    correlationId: CorrelationIdSchema,
    ok: z.literal(false),
    error: z.string(),
    diagnostic: PersistenceDiagnosticSchema,
});
export const EngineSetPermissionOverrideResultSchema = z.union([
    EngineSetPermissionOverrideSuccessSchema,
    EngineSetPermissionOverrideFailureSchema,
]);
export type EngineSetPermissionOverrideResult = z.infer<
    typeof EngineSetPermissionOverrideResultSchema
>;

export const EngineReadPropertiesSchema = z.object({
    type: z.literal(EngineChannel.ReadProperties),
    correlationId: CorrelationIdSchema,
});
export type EngineReadProperties = z.infer<typeof EngineReadPropertiesSchema>;

export const EngineReadPropertiesResultSchema = z.object({
    type: z.literal(EngineChannel.ReadPropertiesResult),
    correlationId: CorrelationIdSchema,
    properties: z.record(z.string(), z.unknown()).readonly(),
    defaults: z.record(z.string(), z.unknown()).readonly().optional(),
});
export type EngineReadPropertiesResult = z.infer<typeof EngineReadPropertiesResultSchema>;

export const EngineSavePropertiesSchema = z.object({
    type: z.literal(EngineChannel.SaveProperties),
    correlationId: CorrelationIdSchema,
    properties: z.record(z.string(), z.unknown()).readonly(),
});
export type EngineSaveProperties = z.infer<typeof EngineSavePropertiesSchema>;

const EngineSavePropertiesSuccessSchema = z.object({
    type: z.literal(EngineChannel.SavePropertiesResult),
    correlationId: CorrelationIdSchema,
    ok: z.literal(true),
});
const EngineSavePropertiesFailureSchema = z.object({
    type: z.literal(EngineChannel.SavePropertiesResult),
    correlationId: CorrelationIdSchema,
    ok: z.literal(false),
    error: z.string(),
    diagnostic: PersistenceDiagnosticSchema,
});
export const EngineSavePropertiesResultSchema = z.union([
    EngineSavePropertiesSuccessSchema,
    EngineSavePropertiesFailureSchema,
]);
export type EngineSavePropertiesResult = z.infer<typeof EngineSavePropertiesResultSchema>;

export const EngineFireManualTriggerSchema = z.object({
    correlationId: CorrelationIdSchema,
    type: z.literal(EngineChannel.FireManualTrigger),
    pipeline: CompiledPipelineSchema,
});
export type EngineFireManualTrigger = z.infer<typeof EngineFireManualTriggerSchema>;

const EngineFireManualTriggerSuccessSchema = z
    .object({
        correlationId: CorrelationIdSchema,
        type: z.literal(EngineChannel.FireManualTriggerResult),
        ok: z.literal(true),
    })
    .strict();
const EngineFireManualTriggerFailureSchema = z
    .object({
        correlationId: CorrelationIdSchema,
        type: z.literal(EngineChannel.FireManualTriggerResult),
        ok: z.literal(false),
        error: z.string(),
    })
    .strict();
export const EngineFireManualTriggerResultSchema = z.union([
    EngineFireManualTriggerSuccessSchema,
    EngineFireManualTriggerFailureSchema,
]);
export type EngineFireManualTriggerResult = z.infer<typeof EngineFireManualTriggerResultSchema>;

export const EngineReadWorkflowStateSchema = z.object({
    type: z.literal(EngineChannel.ReadWorkflowState),
    correlationId: CorrelationIdSchema,
    workflowId: WorkflowIdSchema,
});
export type EngineReadWorkflowState = z.infer<typeof EngineReadWorkflowStateSchema>;

export const EngineReadWorkflowStateResultSchema = z.object({
    type: z.literal(EngineChannel.ReadWorkflowStateResult),
    correlationId: CorrelationIdSchema,
    entries: z.array(WorkflowStateEntrySchema).readonly(),
});
export type EngineReadWorkflowStateResult = z.infer<typeof EngineReadWorkflowStateResultSchema>;

export const EngineSetWorkflowStateKeySchema = z.object({
    type: z.literal(EngineChannel.SetWorkflowStateKey),
    correlationId: CorrelationIdSchema,
    workflowId: WorkflowIdSchema,
    key: z.string(),
    value: z.string(),
});
export type EngineSetWorkflowStateKey = z.infer<typeof EngineSetWorkflowStateKeySchema>;

export const EngineSetWorkflowStateKeyResultSchema = z.object({
    type: z.literal(EngineChannel.SetWorkflowStateKeyResult),
    correlationId: CorrelationIdSchema,
    ok: z.boolean(),
});
export type EngineSetWorkflowStateKeyResult = z.infer<typeof EngineSetWorkflowStateKeyResultSchema>;

export const EngineDeleteWorkflowStateKeySchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowStateKey),
    correlationId: CorrelationIdSchema,
    workflowId: WorkflowIdSchema,
    key: z.string(),
});
export type EngineDeleteWorkflowStateKey = z.infer<typeof EngineDeleteWorkflowStateKeySchema>;

export const EngineDeleteWorkflowStateKeyResultSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowStateKeyResult),
    correlationId: CorrelationIdSchema,
    ok: z.boolean(),
});
export type EngineDeleteWorkflowStateKeyResult = z.infer<
    typeof EngineDeleteWorkflowStateKeyResultSchema
>;

export const EngineShutdownSchema = z.object({
    type: z.literal(EngineChannel.Shutdown),
    correlationId: CorrelationIdSchema,
});
export type EngineShutdown = z.infer<typeof EngineShutdownSchema>;

export const EngineShutdownResultSchema = z.object({
    type: z.literal(EngineChannel.ShutdownResult),
    correlationId: CorrelationIdSchema,
    ok: z.boolean(),
});
export type EngineShutdownResult = z.infer<typeof EngineShutdownResultSchema>;

export const EngineReadySchema = z.object({
    type: z.literal('engine:ready'),
});

export const MainToEngineMessageSchema = z.union([
    EnginePingSchema,
    EngineFireTestEventSchema,
    EngineFireManualTriggerSchema,
    EngineToggleWorkflowSchema,
    EngineRetryWorkflowSchema,
    EngineCreateWorkflowSchema,
    EngineUpdateWorkflowSchema,
    EngineDeleteWorkflowSchema,
    EngineGetWorkflowSchema,
    EngineListPluginsSchema,
    EngineSetPermissionOverrideSchema,
    EngineReadPropertiesSchema,
    EngineSavePropertiesSchema,
    EngineReadWorkflowStateSchema,
    EngineSetWorkflowStateKeySchema,
    EngineDeleteWorkflowStateKeySchema,
    EngineShutdownSchema,
]);
export type MainToEngineMessage = z.infer<typeof MainToEngineMessageSchema>;

export const WorkerInboundSchema = MainToEngineMessageSchema;
export type WorkerInbound = MainToEngineMessage;

export const EngineToMainMessageSchema = z.union([
    EnginePongSchema,
    EngineFireTestEventResultSchema,
    EngineLogSchema,
    EngineWorkflowsListSchema,
    EngineToggleWorkflowResultSchema,
    EngineRetryWorkflowResultSchema,
    EngineCreateWorkflowResultSchema,
    EngineUpdateWorkflowResultSchema,
    EngineDeleteWorkflowResultSchema,
    EngineGetWorkflowResultSchema,
    EngineBusEventSchema,
    EngineListPluginsResultSchema,
    EngineSetPermissionOverrideResultSchema,
    EngineReadPropertiesResultSchema,
    EngineSavePropertiesResultSchema,
    EngineFireManualTriggerResultSchema,
    EngineReadWorkflowStateResultSchema,
    EngineSetWorkflowStateKeyResultSchema,
    EngineDeleteWorkflowStateKeyResultSchema,
    EngineShutdownResultSchema,
]);
export type EngineToMainMessage = z.infer<typeof EngineToMainMessageSchema>;

/** @deprecated Use MainToEngineMessageSchema or EngineToMainMessageSchema. */
export const EngineMessageSchema = EngineToMainMessageSchema;
/** @deprecated Use MainToEngineMessage or EngineToMainMessage. */
export type EngineMessage = EngineToMainMessage;

export const EngineToMainMessageOrReadySchema = z.union([
    EngineToMainMessageSchema,
    EngineReadySchema,
]);
export type EngineToMainMessageOrReady = z.infer<typeof EngineToMainMessageOrReadySchema>;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
    FireTestEvent: 'renderer:fire-test-event',
    EngineLog: 'renderer:engine-log',
    WorkflowsList: 'renderer:workflows-list',
    ToggleWorkflow: 'renderer:toggle-workflow',
    RetryWorkflow: 'renderer:retry-workflow',
    CreateWorkflow: 'renderer:create-workflow',
    UpdateWorkflow: 'renderer:update-workflow',
    DeleteWorkflow: 'renderer:delete-workflow',
    GetWorkflow: 'renderer:get-workflow',
    BusEvent: 'renderer:bus-event',
    RendererReady: 'renderer:renderer-ready',
    ListPlugins: 'renderer:list-plugins',
    SetPermissionOverride: 'renderer:set-permission-override',
    ReadProperties: 'renderer:read-properties',
    SaveProperties: 'renderer:save-properties',
    OpenFileDialog: 'renderer:open-file-dialog',
    FireManualTrigger: 'renderer:fire-manual-trigger',
    ReadWorkflowState: 'renderer:read-workflow-state',
    SetWorkflowStateKey: 'renderer:set-workflow-state-key',
    DeleteWorkflowStateKey: 'renderer:delete-workflow-state-key',
} as const;
