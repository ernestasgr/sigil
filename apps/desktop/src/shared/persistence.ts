import { CapabilitySchema } from '@sigil/schema/manifest';
import { z } from 'zod';

export const PersistenceOperationSchema = z.enum(['read', 'write']);
export type PersistenceOperation = z.infer<typeof PersistenceOperationSchema>;

export const PersistencePhaseSchema = z.enum([
    'directory',
    'open',
    'serialize',
    'write',
    'flush',
    'directory_flush',
    'close',
    'replace',
    'parse',
]);
export type PersistencePhase = z.infer<typeof PersistencePhaseSchema>;

export const PersistenceDiagnosticSchema = z
    .object({
        kind: z.literal('persistence'),
        operation: PersistenceOperationSchema,
        phase: PersistencePhaseSchema,
        path: z.string().min(1),
        message: z.string().min(1),
        code: z.string().optional(),
    })
    .readonly();

export type PersistenceDiagnostic = z.infer<typeof PersistenceDiagnosticSchema>;

export const PersistenceWriteOutcomeSchema = z.union([
    z.object({ ok: z.literal(true) }).readonly(),
    z
        .object({
            ok: z.literal(false),
            error: z.string(),
            diagnostic: PersistenceDiagnosticSchema,
        })
        .readonly(),
]);

export type PersistenceWriteOutcome = z.infer<typeof PersistenceWriteOutcomeSchema>;

export const PermissionOverrideSuccessFieldsSchema = z.object({
    ok: z.literal(true),
    grantedPermissions: z.array(CapabilitySchema).readonly(),
    cancelledRunIds: z.array(z.string().min(1)).readonly(),
});

export const PermissionOverrideDomainFailureFieldsSchema = z.object({
    ok: z.literal(false),
    kind: z.literal('domain'),
    code: z.literal('unknown_plugin'),
    pluginId: z.string().min(1),
    error: z.string().min(1),
});

export const PermissionOverridePersistenceFailureFieldsSchema = z.object({
    ok: z.literal(false),
    kind: z.literal('persistence'),
    error: z.string().min(1),
    diagnostic: PersistenceDiagnosticSchema,
});

export const PermissionOverrideOutcomeSchema = z.union([
    PermissionOverrideSuccessFieldsSchema.readonly(),
    PermissionOverrideDomainFailureFieldsSchema.readonly(),
    PermissionOverridePersistenceFailureFieldsSchema.readonly(),
]);
export type PermissionOverrideOutcome = z.infer<typeof PermissionOverrideOutcomeSchema>;

export const PropertiesApplyStatusSchema = z
    .object({
        /** Hot-applicable values that changed in the running Engine. */
        applied: z.record(z.string(), z.unknown()).readonly(),
        /** Persisted values that will take effect after an Engine restart. */
        restartRequired: z.array(z.string()).readonly(),
    })
    .readonly();
export type PropertiesApplyStatus = z.infer<typeof PropertiesApplyStatusSchema>;

export const PropertiesSaveSuccessFieldsSchema = z.object({
    ok: z.literal(true),
    applied: z.record(z.string(), z.unknown()).readonly(),
    restartRequired: z.array(z.string()).readonly(),
});

export const PropertiesValidationFailureFieldsSchema = z.object({
    ok: z.literal(false),
    kind: z.literal('validation'),
    error: z.string(),
    issues: z.array(z.string()).readonly(),
});

export const PropertiesWriteFailureFieldsSchema = z.object({
    ok: z.literal(false),
    kind: z.literal('write'),
    error: z.string(),
    diagnostic: PersistenceDiagnosticSchema,
});

export const PropertiesSaveOutcomeSchema = z.union([
    PropertiesSaveSuccessFieldsSchema.readonly(),
    PropertiesValidationFailureFieldsSchema.readonly(),
    PropertiesWriteFailureFieldsSchema.readonly(),
]);
export type PropertiesSaveOutcome = z.infer<typeof PropertiesSaveOutcomeSchema>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function persistenceErrorCode(error: unknown): string | undefined {
    if (!isRecord(error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

export function isExpectedMissingFileDiagnostic(diagnostic: PersistenceDiagnostic): boolean {
    return (
        diagnostic.operation === 'read' &&
        diagnostic.phase === 'open' &&
        diagnostic.code === 'ENOENT'
    );
}

export function formatPersistenceDiagnostic(diagnostic: PersistenceDiagnostic): string {
    return `[persistence:${diagnostic.phase}] ${diagnostic.path}: ${diagnostic.message}`;
}
