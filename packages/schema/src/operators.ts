import { z } from 'zod';

export const StringOperatorSchema = z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'matches',
]);
export type StringOperator = z.infer<typeof StringOperatorSchema>;

export const NumberOperatorSchema = z.enum(['equals', 'not_equals', 'gt', 'lt', 'gte', 'lte']);
export type NumberOperator = z.infer<typeof NumberOperatorSchema>;

export const BooleanOperatorSchema = z.enum(['equals', 'not_equals']);
export type BooleanOperator = z.infer<typeof BooleanOperatorSchema>;
