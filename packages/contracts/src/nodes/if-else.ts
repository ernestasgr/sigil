import { z } from 'zod';

import { PipelineConditionSchema } from '../conditions.js';

export const IfElseConfigSchema = z.object({ condition: PipelineConditionSchema }).strict();
export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;
