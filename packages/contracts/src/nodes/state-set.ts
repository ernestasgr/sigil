import { z } from 'zod';

export const STATE_SET_VALUE_TYPES = ['string', 'number', 'boolean'] as const;
export const StateSetValueTypeSchema = z.enum(STATE_SET_VALUE_TYPES);
export type StateSetValueType = z.infer<typeof StateSetValueTypeSchema>;

export const StateSetConfigSchema = z
    .object({
        key: z.string().min(1),
        valueTemplate: z.string(),
        valueType: StateSetValueTypeSchema.default('string'),
    })
    .strict();
export type StateSetConfig = z.infer<typeof StateSetConfigSchema>;
