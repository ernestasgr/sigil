import { z } from 'zod';

export const PersistenceOperationSchema = z.enum(['read', 'write']);
export type PersistenceOperation = z.infer<typeof PersistenceOperationSchema>;

export const PersistencePhaseSchema = z.enum([
    'directory',
    'open',
    'serialize',
    'write',
    'flush',
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

export function formatPersistenceDiagnostic(diagnostic: PersistenceDiagnostic): string {
    return `[persistence:${diagnostic.phase}] ${diagnostic.path}: ${diagnostic.message}`;
}
