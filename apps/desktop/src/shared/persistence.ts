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
