import { z } from 'zod';

export const TelemetryKindSchema = z.enum([
    'lifecycle',
    'node',
    'queue',
    'plugin',
    'outcome',
    'diagnostic',
]);
export type TelemetryKind = z.infer<typeof TelemetryKindSchema>;

export const TelemetrySeveritySchema = z.enum(['debug', 'info', 'warn', 'error']);
export type TelemetrySeverity = z.infer<typeof TelemetrySeveritySchema>;

export const TelemetryOutcomeSchema = z.enum([
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'dropped',
]);
export type TelemetryOutcome = z.infer<typeof TelemetryOutcomeSchema>;

export const EventTelemetrySchema = z
    .object({
        eventId: z.string().min(1),
        timestamp: z.number().finite().nonnegative(),
        kind: TelemetryKindSchema,
        severity: TelemetrySeveritySchema,
        workflowId: z.string().min(1).optional(),
        pipelineId: z.string().min(1).optional(),
        runId: z.string().min(1).optional(),
        nodeId: z.string().min(1).optional(),
        nodeType: z.string().min(1).optional(),
        pluginId: z.string().min(1).optional(),
        outcome: TelemetryOutcomeSchema.optional(),
        durationMs: z.number().finite().nonnegative().optional(),
        summary: z.string().max(256),
    })
    .strict()
    .readonly();
export type EventTelemetry = z.infer<typeof EventTelemetrySchema>;
