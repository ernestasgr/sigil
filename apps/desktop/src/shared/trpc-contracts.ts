import { WorkflowDocumentSchema } from '@sigil/schema';
import { FileEventPayloadSchema } from '@sigil/schema/file-event-payload';
import { PluginIdSchema } from '@sigil/schema/ids';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { z } from 'zod';

import {
    EngineBusEventPayloadSchema,
    EnginePongSchema,
    NodePositionRecordSchema,
    PluginInfoSchema,
    type WorkflowActionOutcome,
    WorkflowActionOutcomeSchema,
    type WorkflowDeleteOutcome,
    WorkflowDeleteOutcomeSchema,
    WorkflowIdSchema,
    WorkflowStateEntrySchema,
    WorkflowStatePrimitiveSchema,
    type WorkflowWriteOutcome,
    WorkflowWriteOutcomeSchema,
} from './ipc-channels.js';
import {
    type PermissionOverrideOutcome,
    PermissionOverrideOutcomeSchema,
    type PropertiesSaveOutcome,
    PropertiesSaveOutcomeSchema,
} from './persistence.js';

export const CommandExecutionOutcomeSchema = z
    .union([
        z.object({ ok: z.literal(true) }).readonly(),
        z.object({ ok: z.literal(false), error: z.string() }).readonly(),
    ])
    .readonly();
export type CommandExecutionOutcome = z.infer<typeof CommandExecutionOutcomeSchema>;

export const WorkflowWriteInputSchema = z
    .object({
        name: z.string(),
        document: WorkflowDocumentSchema,
        positions: NodePositionRecordSchema,
    })
    .readonly();
export type WorkflowWriteInput = z.input<typeof WorkflowWriteInputSchema>;

export const WorkflowUpdateInputSchema = z
    .object({
        id: WorkflowIdSchema,
        name: z.string(),
        document: WorkflowDocumentSchema,
        positions: NodePositionRecordSchema,
    })
    .superRefine((input, ctx) => {
        if (input.id !== input.document.workflowId) {
            ctx.addIssue({
                code: 'custom',
                path: ['document', 'workflowId'],
                message: 'Workflow document workflowId must match the requested Workflow id.',
            });
        }
    })
    .readonly();
export type WorkflowUpdateInput = z.input<typeof WorkflowUpdateInputSchema>;

export const WorkflowIdInputSchema = z.object({ id: WorkflowIdSchema }).readonly();
export type WorkflowIdInput = z.input<typeof WorkflowIdInputSchema>;

export const PermissionOverrideInputSchema = z
    .object({
        pluginId: PluginIdSchema,
        overrides: z.array(CapabilitySchema).readonly(),
    })
    .readonly();
export type PermissionOverrideInput = z.input<typeof PermissionOverrideInputSchema>;

export const PropertiesReadOutputSchema = z
    .object({
        properties: z.record(z.string(), z.unknown()).readonly(),
        defaults: z.record(z.string(), z.unknown()).readonly().optional(),
    })
    .readonly();
export type PropertiesReadOutput = z.infer<typeof PropertiesReadOutputSchema>;

export const PropertiesSaveInputSchema = z.record(z.string(), z.unknown()).readonly();
export type PropertiesSaveInput = z.input<typeof PropertiesSaveInputSchema>;

export const SetWorkflowStateKeyInputSchema = z
    .object({
        workflowId: WorkflowIdSchema,
        key: z.string(),
        value: WorkflowStatePrimitiveSchema,
    })
    .readonly();
export type SetWorkflowStateKeyInput = z.input<typeof SetWorkflowStateKeyInputSchema>;

export const DeleteWorkflowStateKeyInputSchema = z
    .object({
        workflowId: WorkflowIdSchema,
        key: z.string(),
    })
    .readonly();
export type DeleteWorkflowStateKeyInput = z.input<typeof DeleteWorkflowStateKeyInputSchema>;

export const PingEngineOutputSchema = z.union([EnginePongSchema, z.null()]);
export type PingEngineOutput = z.infer<typeof PingEngineOutputSchema>;

export const GetWorkflowOutputSchema = z.union([
    z
        .object({
            name: z.string(),
            document: WorkflowDocumentSchema,
            positions: NodePositionRecordSchema,
        })
        .readonly(),
    z.null(),
]);
export type GetWorkflowOutput = z.infer<typeof GetWorkflowOutputSchema>;

export const ListPluginsOutputSchema = z.array(PluginInfoSchema).readonly();
export type ListPluginsOutput = z.infer<typeof ListPluginsOutputSchema>;

export const ReadWorkflowStateOutputSchema = z.array(WorkflowStateEntrySchema).readonly();
export type ReadWorkflowStateOutput = z.infer<typeof ReadWorkflowStateOutputSchema>;

export const OpenFileDialogOutputSchema = FileEventPayloadSchema.nullable();
export type OpenFileDialogOutput = z.infer<typeof OpenFileDialogOutputSchema>;

export type {
    PermissionOverrideOutcome,
    PropertiesSaveOutcome,
    WorkflowActionOutcome,
    WorkflowDeleteOutcome,
    WorkflowWriteOutcome,
};
export {
    EngineBusEventPayloadSchema,
    PermissionOverrideOutcomeSchema,
    PropertiesSaveOutcomeSchema,
    WorkflowActionOutcomeSchema,
    WorkflowDeleteOutcomeSchema,
    WorkflowWriteOutcomeSchema,
};
