import { CompiledPipelineSchema } from '@sigil/schema';
import { CapabilitySchema, ManifestSchema } from '@sigil/schema/manifest';
import { TopologyDiagnosticSchema } from '@sigil/schema/topology';
import { z } from 'zod';
import { PersistenceDiagnosticSchema } from './persistence.js';
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

const NodePositionSchema = z.object({ x: z.number(), y: z.number() }).readonly();
export const NodePositionRecordSchema = z.record(z.string(), NodePositionSchema).readonly();

const WorkflowStateEntrySchema = z
    .object({
        key: z.string(),
        value: z.string(),
    })
    .readonly();
export type WorkflowStateEntry = z.infer<typeof WorkflowStateEntrySchema>;

const EngineBusEventPayloadSchema = z
    .object({
        name: z.string(),
        payload: z.unknown(),
    })
    .readonly();
export type EngineBusEventPayload = z.infer<typeof EngineBusEventPayloadSchema>;

const PluginInfoSchema = z
    .object({
        manifest: ManifestSchema,
        grantedPermissions: z.array(CapabilitySchema).readonly(),
    })
    .readonly();

export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
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
    id: z.string(),
    type: z.literal(EngineChannel.Ping),
});
export type EnginePing = z.infer<typeof EnginePingSchema>;
export const EnginePongSchema = z.object({
    id: z.string(),
    type: z.literal(EngineChannel.Pong),
    receivedAt: z.number(),
});
export type EnginePong = z.infer<typeof EnginePongSchema>;

export const EngineFireTestEventSchema = z.object({
    type: z.literal(EngineChannel.FireTestEvent),
});
export type EngineFireTestEvent = z.infer<typeof EngineFireTestEventSchema>;

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
    correlationId: z.string(),
    id: WorkflowIdSchema,
});
export type EngineToggleWorkflow = z.infer<typeof EngineToggleWorkflowSchema>;

const EngineToggleWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.ToggleWorkflowResult),
    correlationId: z.string(),
    summary: WorkflowSummarySchema.nullable(),
});
const EngineToggleWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.ToggleWorkflowResult),
    correlationId: z.string(),
    summary: z.null(),
    error: z.string(),
    diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
});
export const EngineToggleWorkflowResultSchema = z.union([
    EngineToggleWorkflowFailureSchema,
    EngineToggleWorkflowSuccessSchema,
]);
export type EngineToggleWorkflowResult = z.infer<typeof EngineToggleWorkflowResultSchema>;

export const EngineRetryWorkflowSchema = z.object({
    type: z.literal(EngineChannel.RetryWorkflow),
    correlationId: z.string(),
    id: WorkflowIdSchema,
});
export type EngineRetryWorkflow = z.infer<typeof EngineRetryWorkflowSchema>;

const EngineRetryWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.RetryWorkflowResult),
    correlationId: z.string(),
    summary: WorkflowSummarySchema.nullable(),
});
const EngineRetryWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.RetryWorkflowResult),
    correlationId: z.string(),
    summary: z.null(),
    error: z.string(),
    diagnostics: z.array(PersistenceDiagnosticSchema).readonly(),
});
export const EngineRetryWorkflowResultSchema = z.union([
    EngineRetryWorkflowFailureSchema,
    EngineRetryWorkflowSuccessSchema,
]);
export type EngineRetryWorkflowResult = z.infer<typeof EngineRetryWorkflowResultSchema>;

export const EngineCreateWorkflowSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflow),
    correlationId: z.string(),
    name: z.string(),
    pipeline: CompiledPipelineSchema,
    positions: NodePositionRecordSchema,
});
export type EngineCreateWorkflow = z.infer<typeof EngineCreateWorkflowSchema>;

const EngineCreateWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflowResult),
    correlationId: z.string(),
    summary: WorkflowSummarySchema,
});
const EngineCreateWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.CreateWorkflowResult),
    correlationId: z.string(),
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
        correlationId: z.string(),
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
    correlationId: z.string(),
    summary: WorkflowSummarySchema,
});
const EngineUpdateWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.UpdateWorkflowResult),
    correlationId: z.string(),
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
    correlationId: z.string(),
    id: WorkflowIdSchema,
});
export type EngineDeleteWorkflow = z.infer<typeof EngineDeleteWorkflowSchema>;

const EngineDeleteWorkflowSuccessSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowResult),
    correlationId: z.string(),
    success: z.literal(true),
});
const EngineDeleteWorkflowNotFoundSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowResult),
    correlationId: z.string(),
    success: z.literal(false),
});
const EngineDeleteWorkflowFailureSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowResult),
    correlationId: z.string(),
    success: z.literal(false),
    error: z.string(),
    diagnostic: PersistenceDiagnosticSchema,
});
export const EngineDeleteWorkflowResultSchema = z.union([
    EngineDeleteWorkflowFailureSchema,
    EngineDeleteWorkflowSuccessSchema,
    EngineDeleteWorkflowNotFoundSchema,
]);
export type EngineDeleteWorkflowResult = z.infer<typeof EngineDeleteWorkflowResultSchema>;

export const EngineGetWorkflowSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflow),
    id: WorkflowIdSchema,
    correlationId: z.string(),
});
export type EngineGetWorkflow = z.infer<typeof EngineGetWorkflowSchema>;

export const EngineGetWorkflowResultFoundSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflowResult),
    correlationId: z.string(),
    found: z.literal(true),
    name: z.string(),
    pipeline: CompiledPipelineSchema,
    positions: NodePositionRecordSchema,
});
export type EngineGetWorkflowResultFound = z.infer<typeof EngineGetWorkflowResultFoundSchema>;

export const EngineGetWorkflowResultNotFoundSchema = z.object({
    type: z.literal(EngineChannel.GetWorkflowResult),
    correlationId: z.string(),
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
    correlationId: z.string(),
});
export type EngineListPlugins = z.infer<typeof EngineListPluginsSchema>;

export const EngineListPluginsResultSchema = z.object({
    type: z.literal(EngineChannel.ListPluginsResult),
    correlationId: z.string(),
    plugins: z.array(PluginInfoSchema).readonly(),
});
export type EngineListPluginsResult = z.infer<typeof EngineListPluginsResultSchema>;

export const EngineSetPermissionOverrideSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverride),
    correlationId: z.string(),
    pluginId: z.string(),
    overrides: z.array(CapabilitySchema).readonly(),
});
export type EngineSetPermissionOverride = z.infer<typeof EngineSetPermissionOverrideSchema>;

const EngineSetPermissionOverrideSuccessSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverrideResult),
    correlationId: z.string(),
    ok: z.literal(true),
});
const EngineSetPermissionOverrideFailureSchema = z.object({
    type: z.literal(EngineChannel.SetPermissionOverrideResult),
    correlationId: z.string(),
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
    correlationId: z.string(),
});
export type EngineReadProperties = z.infer<typeof EngineReadPropertiesSchema>;

export const EngineReadPropertiesResultSchema = z.object({
    type: z.literal(EngineChannel.ReadPropertiesResult),
    correlationId: z.string(),
    properties: z.record(z.string(), z.unknown()).readonly(),
});
export type EngineReadPropertiesResult = z.infer<typeof EngineReadPropertiesResultSchema>;

export const EngineSavePropertiesSchema = z.object({
    type: z.literal(EngineChannel.SaveProperties),
    correlationId: z.string(),
    properties: z.record(z.string(), z.unknown()).readonly(),
});
export type EngineSaveProperties = z.infer<typeof EngineSavePropertiesSchema>;

const EngineSavePropertiesSuccessSchema = z.object({
    type: z.literal(EngineChannel.SavePropertiesResult),
    correlationId: z.string(),
    ok: z.literal(true),
});
const EngineSavePropertiesFailureSchema = z.object({
    type: z.literal(EngineChannel.SavePropertiesResult),
    correlationId: z.string(),
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
    type: z.literal(EngineChannel.FireManualTrigger),
    pipeline: CompiledPipelineSchema,
});
export type EngineFireManualTrigger = z.infer<typeof EngineFireManualTriggerSchema>;

export const EngineReadWorkflowStateSchema = z.object({
    type: z.literal(EngineChannel.ReadWorkflowState),
    correlationId: z.string(),
    workflowId: WorkflowIdSchema,
});
export type EngineReadWorkflowState = z.infer<typeof EngineReadWorkflowStateSchema>;

export const EngineReadWorkflowStateResultSchema = z.object({
    type: z.literal(EngineChannel.ReadWorkflowStateResult),
    correlationId: z.string(),
    entries: z.array(WorkflowStateEntrySchema).readonly(),
});
export type EngineReadWorkflowStateResult = z.infer<typeof EngineReadWorkflowStateResultSchema>;

export const EngineSetWorkflowStateKeySchema = z.object({
    type: z.literal(EngineChannel.SetWorkflowStateKey),
    correlationId: z.string(),
    workflowId: WorkflowIdSchema,
    key: z.string(),
    value: z.string(),
});
export type EngineSetWorkflowStateKey = z.infer<typeof EngineSetWorkflowStateKeySchema>;

export const EngineSetWorkflowStateKeyResultSchema = z.object({
    type: z.literal(EngineChannel.SetWorkflowStateKeyResult),
    correlationId: z.string(),
    ok: z.boolean(),
});
export type EngineSetWorkflowStateKeyResult = z.infer<typeof EngineSetWorkflowStateKeyResultSchema>;

export const EngineDeleteWorkflowStateKeySchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowStateKey),
    correlationId: z.string(),
    workflowId: WorkflowIdSchema,
    key: z.string(),
});
export type EngineDeleteWorkflowStateKey = z.infer<typeof EngineDeleteWorkflowStateKeySchema>;

export const EngineDeleteWorkflowStateKeyResultSchema = z.object({
    type: z.literal(EngineChannel.DeleteWorkflowStateKeyResult),
    correlationId: z.string(),
    ok: z.boolean(),
});
export type EngineDeleteWorkflowStateKeyResult = z.infer<
    typeof EngineDeleteWorkflowStateKeyResultSchema
>;

export const EngineShutdownSchema = z.object({
    type: z.literal(EngineChannel.Shutdown),
    correlationId: z.string(),
});
export type EngineShutdown = z.infer<typeof EngineShutdownSchema>;

export const EngineShutdownResultSchema = z.object({
    type: z.literal(EngineChannel.ShutdownResult),
    correlationId: z.string(),
    ok: z.boolean(),
});
export type EngineShutdownResult = z.infer<typeof EngineShutdownResultSchema>;

export const EngineMessageSchema = z.union([
    EnginePingSchema,
    EnginePongSchema,
    EngineFireTestEventSchema,
    EngineLogSchema,
    EngineWorkflowsListSchema,
    EngineToggleWorkflowSchema,
    EngineToggleWorkflowResultSchema,
    EngineRetryWorkflowSchema,
    EngineRetryWorkflowResultSchema,
    EngineCreateWorkflowSchema,
    EngineCreateWorkflowResultSchema,
    EngineUpdateWorkflowSchema,
    EngineUpdateWorkflowResultSchema,
    EngineDeleteWorkflowSchema,
    EngineDeleteWorkflowResultSchema,
    EngineGetWorkflowSchema,
    EngineGetWorkflowResultSchema,
    EngineBusEventSchema,
    EngineListPluginsSchema,
    EngineListPluginsResultSchema,
    EngineSetPermissionOverrideSchema,
    EngineSetPermissionOverrideResultSchema,
    EngineReadPropertiesSchema,
    EngineReadPropertiesResultSchema,
    EngineSavePropertiesSchema,
    EngineSavePropertiesResultSchema,
    EngineFireManualTriggerSchema,
    EngineReadWorkflowStateSchema,
    EngineReadWorkflowStateResultSchema,
    EngineSetWorkflowStateKeySchema,
    EngineSetWorkflowStateKeyResultSchema,
    EngineDeleteWorkflowStateKeySchema,
    EngineDeleteWorkflowStateKeyResultSchema,
    EngineShutdownSchema,
    EngineShutdownResultSchema,
]);

export type EngineMessage = z.infer<typeof EngineMessageSchema>;

export const EngineReadySchema = z.object({
    type: z.literal('engine:ready'),
});

export const WorkerInboundSchema = z.union([
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
export type WorkerInbound = z.infer<typeof WorkerInboundSchema>;

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
