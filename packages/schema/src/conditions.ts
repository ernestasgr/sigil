import { z } from 'zod';
import { BooleanOperatorSchema, NumberOperatorSchema, StringOperatorSchema } from './operators.js';

const FileStringConditionSchema = z.object({
    target: z.literal('event'),
    field: z.enum(['path', 'name', 'ext', 'dir']),
    operator: StringOperatorSchema,
    value: z.string(),
});

const FileSizeConditionSchema = z.object({
    target: z.literal('event'),
    field: z.literal('size'),
    operator: NumberOperatorSchema,
    value: z.number(),
});

export const FileConditionSchema = z.union([FileStringConditionSchema, FileSizeConditionSchema]);
export type FileCondition = z.infer<typeof FileConditionSchema>;

const VarStringConditionSchema = z.object({
    target: z.literal('vars'),
    field: z.string().min(1),
    operator: StringOperatorSchema,
    value: z.string(),
});

const VarNumberConditionSchema = z.object({
    target: z.literal('vars'),
    field: z.string().min(1),
    operator: NumberOperatorSchema,
    value: z.number(),
});

const VarBooleanConditionSchema = z.object({
    target: z.literal('vars'),
    field: z.string().min(1),
    operator: BooleanOperatorSchema,
    value: z.boolean(),
});

export const VarConditionSchema = z.union([
    VarStringConditionSchema,
    VarNumberConditionSchema,
    VarBooleanConditionSchema,
]);
export type VarCondition = z.infer<typeof VarConditionSchema>;

export const PipelineConditionSchema = z.union([FileConditionSchema, VarConditionSchema]);
export type PipelineCondition = z.infer<typeof PipelineConditionSchema>;
