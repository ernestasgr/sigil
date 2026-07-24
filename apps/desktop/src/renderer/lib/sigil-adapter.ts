import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import { z } from 'zod';

import type { AppRouter } from '../../main/trpc/router.js';
import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import { EngineBusEventPayloadSchema } from '../../shared/ipc-channels.js';
import {
    CommandExecutionOutcomeSchema,
    type DeleteWorkflowStateKeyInput,
    GetWorkflowOutputSchema,
    ListPluginsOutputSchema,
    OpenFileDialogOutputSchema,
    type PermissionOverrideInput,
    PermissionOverrideOutcomeSchema,
    PingEngineOutputSchema,
    PropertiesReadOutputSchema,
    type PropertiesSaveInput,
    PropertiesSaveOutcomeSchema,
    ReadWorkflowStateOutputSchema,
    type SetWorkflowStateKeyInput,
    WorkflowActionOutcomeSchema,
    WorkflowDeleteOutcomeSchema,
    type WorkflowIdInput,
    type WorkflowUpdateInput,
    type WorkflowWriteInput,
    WorkflowWriteOutcomeSchema,
} from '../../shared/trpc-contracts.js';
import { type WorkflowSummary, WorkflowSummarySchema } from '../../shared/workflow.js';

export type SigilAdapter = {
    readonly pingEngine: () => Promise<z.infer<typeof PingEngineOutputSchema>>;
    readonly fireTestEvent: () => Promise<z.infer<typeof CommandExecutionOutcomeSchema>>;
    readonly toggleWorkflow: (
        id: WorkflowIdInput['id'],
    ) => Promise<z.infer<typeof WorkflowActionOutcomeSchema>>;
    readonly retryWorkflow: (
        id: WorkflowIdInput['id'],
    ) => Promise<z.infer<typeof WorkflowActionOutcomeSchema>>;
    readonly createWorkflow: (
        name: WorkflowWriteInput['name'],
        pipeline: WorkflowWriteInput['pipeline'],
        positions: WorkflowWriteInput['positions'],
    ) => Promise<z.infer<typeof WorkflowWriteOutcomeSchema>>;
    readonly updateWorkflow: (
        id: WorkflowUpdateInput['id'],
        name: WorkflowUpdateInput['name'],
        pipeline: WorkflowUpdateInput['pipeline'],
        positions: WorkflowUpdateInput['positions'],
    ) => Promise<z.infer<typeof WorkflowWriteOutcomeSchema>>;
    readonly deleteWorkflow: (
        id: WorkflowIdInput['id'],
    ) => Promise<z.infer<typeof WorkflowDeleteOutcomeSchema>>;
    readonly getWorkflow: (
        id: WorkflowIdInput['id'],
    ) => Promise<z.infer<typeof GetWorkflowOutputSchema>>;
    readonly listPlugins: () => Promise<z.infer<typeof ListPluginsOutputSchema>>;
    readonly setPermissionOverride: (
        pluginId: PermissionOverrideInput['pluginId'],
        overrides: PermissionOverrideInput['overrides'],
    ) => Promise<z.infer<typeof PermissionOverrideOutcomeSchema>>;
    readonly readProperties: () => Promise<z.infer<typeof PropertiesReadOutputSchema>>;
    readonly saveProperties: (
        properties: PropertiesSaveInput,
    ) => Promise<z.infer<typeof PropertiesSaveOutcomeSchema>>;
    readonly openFileDialog: () => Promise<z.infer<typeof OpenFileDialogOutputSchema>>;
    readonly fireManualTrigger: (
        pipeline: WorkflowWriteInput['pipeline'],
    ) => Promise<z.infer<typeof CommandExecutionOutcomeSchema>>;
    readonly readWorkflowState: (
        id: WorkflowIdInput['id'],
    ) => Promise<z.infer<typeof ReadWorkflowStateOutputSchema>>;
    readonly setWorkflowStateKey: (
        workflowId: SetWorkflowStateKeyInput['workflowId'],
        key: SetWorkflowStateKeyInput['key'],
        value: SetWorkflowStateKeyInput['value'],
    ) => Promise<boolean>;
    readonly deleteWorkflowStateKey: (
        workflowId: DeleteWorkflowStateKeyInput['workflowId'],
        key: DeleteWorkflowStateKeyInput['key'],
    ) => Promise<boolean>;
    readonly onEngineLog: (handler: (line: string) => void) => () => void;
    readonly onWorkflowsList: (
        handler: (workflows: readonly WorkflowSummary[]) => void,
    ) => () => void;
    readonly onBusEvent: (handler: (event: EngineBusEventPayload) => void) => () => void;
};

const client = createTRPCProxyClient<AppRouter>({
    links: [ipcLink<AppRouter>()],
});

function parseResult<T>(schema: z.ZodType<T>, result: unknown): T {
    return schema.parse(result);
}

function reportSubscriptionError(name: string, error: unknown): void {
    console.error(`[renderer] ${name} subscription failed:`, error);
}

const adapter = {
    pingEngine: () =>
        client.pingEngine.query().then((result) => parseResult(PingEngineOutputSchema, result)),
    fireTestEvent: () =>
        client.fireTestEvent
            .mutate()
            .then((result) => parseResult(CommandExecutionOutcomeSchema, result)),
    toggleWorkflow: (id: WorkflowIdInput['id']) =>
        client.toggleWorkflow
            .mutate({ id })
            .then((result) => parseResult(WorkflowActionOutcomeSchema, result)),
    retryWorkflow: (id: WorkflowIdInput['id']) =>
        client.retryWorkflow
            .mutate({ id })
            .then((result) => parseResult(WorkflowActionOutcomeSchema, result)),
    createWorkflow: (
        name: WorkflowWriteInput['name'],
        pipeline: WorkflowWriteInput['pipeline'],
        positions: WorkflowWriteInput['positions'],
    ) =>
        client.createWorkflow
            .mutate({ name, pipeline, positions })
            .then((result) => parseResult(WorkflowWriteOutcomeSchema, result)),
    updateWorkflow: (
        id: WorkflowUpdateInput['id'],
        name: WorkflowUpdateInput['name'],
        pipeline: WorkflowUpdateInput['pipeline'],
        positions: WorkflowUpdateInput['positions'],
    ) =>
        client.updateWorkflow
            .mutate({ id, name, pipeline, positions })
            .then((result) => parseResult(WorkflowWriteOutcomeSchema, result)),
    deleteWorkflow: (id: WorkflowIdInput['id']) =>
        client.deleteWorkflow
            .mutate({ id })
            .then((result) => parseResult(WorkflowDeleteOutcomeSchema, result)),
    getWorkflow: (id: WorkflowIdInput['id']) =>
        client.getWorkflow
            .query({ id })
            .then((result) => parseResult(GetWorkflowOutputSchema, result)),
    listPlugins: () =>
        client.listPlugins.query().then((result) => parseResult(ListPluginsOutputSchema, result)),
    setPermissionOverride: (
        pluginId: PermissionOverrideInput['pluginId'],
        overrides: PermissionOverrideInput['overrides'],
    ) =>
        client.setPermissionOverride
            .mutate({ pluginId, overrides })
            .then((result) => parseResult(PermissionOverrideOutcomeSchema, result)),
    readProperties: () =>
        client.readProperties
            .query()
            .then((result) => parseResult(PropertiesReadOutputSchema, result)),
    saveProperties: (properties: PropertiesSaveInput) =>
        client.saveProperties
            .mutate(properties)
            .then((result) => parseResult(PropertiesSaveOutcomeSchema, result)),
    openFileDialog: () =>
        client.openFileDialog
            .mutate()
            .then((result) => parseResult(OpenFileDialogOutputSchema, result)),
    fireManualTrigger: (pipeline: WorkflowWriteInput['pipeline']) =>
        client.fireManualTrigger
            .mutate(pipeline)
            .then((result) => parseResult(CommandExecutionOutcomeSchema, result)),
    readWorkflowState: (id: WorkflowIdInput['id']) =>
        client.readWorkflowState
            .query({ id })
            .then((result) => parseResult(ReadWorkflowStateOutputSchema, result)),
    setWorkflowStateKey: (
        workflowId: SetWorkflowStateKeyInput['workflowId'],
        key: SetWorkflowStateKeyInput['key'],
        value: SetWorkflowStateKeyInput['value'],
    ) => client.setWorkflowStateKey.mutate({ workflowId, key, value }),
    deleteWorkflowStateKey: (
        workflowId: DeleteWorkflowStateKeyInput['workflowId'],
        key: DeleteWorkflowStateKeyInput['key'],
    ) => client.deleteWorkflowStateKey.mutate({ workflowId, key }),
    onEngineLog: (handler: (line: string) => void): (() => void) => {
        const subscription = client.onEngineLog.subscribe(undefined, {
            onData: (result) => handler(z.string().parse(result)),
            onError: (error) => reportSubscriptionError('onEngineLog', error),
        });
        return () => subscription.unsubscribe();
    },
    onWorkflowsList: (handler: (workflows: readonly WorkflowSummary[]) => void): (() => void) => {
        const subscription = client.onWorkflowsList.subscribe(undefined, {
            onData: (result) =>
                handler(parseResult(z.array(WorkflowSummarySchema).readonly(), result)),
            onError: (error) => reportSubscriptionError('onWorkflowsList', error),
        });
        return () => subscription.unsubscribe();
    },
    onBusEvent: (handler: (event: EngineBusEventPayload) => void): (() => void) => {
        const subscription = client.onBusEvent.subscribe(undefined, {
            onData: (result) => handler(parseResult(EngineBusEventPayloadSchema, result)),
            onError: (error) => reportSubscriptionError('onBusEvent', error),
        });
        return () => subscription.unsubscribe();
    },
} satisfies SigilAdapter;

export function createSigilAdapter(): SigilAdapter {
    return adapter;
}
