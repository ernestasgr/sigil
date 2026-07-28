import { z } from 'zod';

import { NodeOutputPortIdSchema, SwitchCaseIdSchema } from '../ids.js';

export type { SwitchCaseId } from '../ids.js';
export { SwitchCaseIdSchema } from '../ids.js';

export const SWITCH_DEFAULT_PORT = 'default' as const;

export const SwitchCaseSchema = z
    .object({
        id: SwitchCaseIdSchema,
        value: z.string(),
    })
    .strict()
    .readonly();
export type SwitchCase = z.infer<typeof SwitchCaseSchema>;

const SwitchCasesSchema = z.array(SwitchCaseSchema).readonly();

export const SwitchComparisonSchema = z.enum(['string', 'number']);
export type SwitchComparison = z.infer<typeof SwitchComparisonSchema>;

const EventNameSwitchSchema = z
    .object({ target: z.literal('event'), cases: SwitchCasesSchema })
    .strict()
    .readonly();

const FieldSwitchSchema = z
    .object({
        target: z.enum(['payload', 'vars']),
        field: z.string().min(1),
        comparison: SwitchComparisonSchema,
        cases: SwitchCasesSchema,
    })
    .strict()
    .readonly();

export const SwitchConfigSchema = z.union([EventNameSwitchSchema, FieldSwitchSchema]);
export type SwitchConfig = z.infer<typeof SwitchConfigSchema>;

export const SwitchOutputPortIdSchema = NodeOutputPortIdSchema;
