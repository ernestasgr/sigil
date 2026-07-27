import { z } from 'zod';
import { CanonicalEventNameSchema } from './ids.js';
import { validateMatchPattern } from './match-pattern.js';
import { BooleanOperatorSchema, NumberOperatorSchema, StringOperatorSchema } from './operators.js';

const EventNameComparisonOperatorSchema = z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
]);

const EventNameConditionSchema = z.union([
    z
        .object({
            target: z.literal('event'),
            operator: EventNameComparisonOperatorSchema,
            value: CanonicalEventNameSchema,
        })
        .strict()
        .readonly(),
    z
        .object({
            target: z.literal('event'),
            operator: z.literal('matches'),
            value: z.string(),
        })
        .strict()
        .superRefine((condition, ctx) => {
            const pattern = validateMatchPattern(condition.value);
            if (!pattern.ok) {
                ctx.addIssue({ code: 'custom', path: ['value'], message: pattern.issue.message });
            }
        })
        .readonly(),
]);

/*
 * Event comparison values are canonical Event names. A `matches` value is a
 * pattern source instead, so it has its own branch and the identity contract
 * remains closed for every other Event operator.
 */
export type EventNameCondition = z.infer<typeof EventNameConditionSchema>;

const FieldTargetSchema = z.enum(['payload', 'vars']);

const FieldStringConditionSchema = z
    .object({
        target: FieldTargetSchema,
        field: z.string().min(1),
        operator: StringOperatorSchema,
        value: z.string(),
    })
    .strict()
    .superRefine((condition, ctx) => {
        if (condition.operator !== 'matches') return;
        const pattern = validateMatchPattern(condition.value);
        if (!pattern.ok) {
            ctx.addIssue({ code: 'custom', path: ['value'], message: pattern.issue.message });
        }
    })
    .readonly();

const FieldNumberConditionSchema = z
    .object({
        target: FieldTargetSchema,
        field: z.string().min(1),
        operator: NumberOperatorSchema,
        value: z.number(),
    })
    .strict()
    .readonly();

const FieldBooleanConditionSchema = z
    .object({
        target: FieldTargetSchema,
        field: z.string().min(1),
        operator: BooleanOperatorSchema,
        value: z.boolean(),
    })
    .strict()
    .readonly();

export const FieldConditionSchema = z.union([
    FieldStringConditionSchema,
    FieldNumberConditionSchema,
    FieldBooleanConditionSchema,
]);
export type FieldCondition = z.infer<typeof FieldConditionSchema>;

export const PipelineConditionSchema = z.union([EventNameConditionSchema, FieldConditionSchema]);
export type PipelineCondition = z.infer<typeof PipelineConditionSchema>;
