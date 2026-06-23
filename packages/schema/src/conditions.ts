import { z } from 'zod';
import { BooleanOperatorSchema, NumberOperatorSchema, StringOperatorSchema } from './operators.js';

const EventNameConditionSchema = z
    .object({
        target: z.literal('event'),
        operator: StringOperatorSchema,
        value: z.string(),
    })
    .strict();

export type EventNameCondition = z.infer<typeof EventNameConditionSchema>;

const FieldTargetSchema = z.enum(['payload', 'vars']);

const FieldStringConditionSchema = z.object({
    target: FieldTargetSchema,
    field: z.string().min(1),
    operator: StringOperatorSchema,
    value: z.string(),
});

const FieldNumberConditionSchema = z.object({
    target: FieldTargetSchema,
    field: z.string().min(1),
    operator: NumberOperatorSchema,
    value: z.number(),
});

const FieldBooleanConditionSchema = z.object({
    target: FieldTargetSchema,
    field: z.string().min(1),
    operator: BooleanOperatorSchema,
    value: z.boolean(),
});

export const FieldConditionSchema = z.union([
    FieldStringConditionSchema,
    FieldNumberConditionSchema,
    FieldBooleanConditionSchema,
]);
export type FieldCondition = z.infer<typeof FieldConditionSchema>;

export const PipelineConditionSchema = z.union([EventNameConditionSchema, FieldConditionSchema]);
export type PipelineCondition = z.infer<typeof PipelineConditionSchema>;
