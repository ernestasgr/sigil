import { z } from 'zod';

import { PipelineConditionSchema } from '../conditions.js';
import { EventNameSchema } from '../ids.js';
import { defineNode } from './types.js';

export const IfElseConfigSchema = z.object({ condition: PipelineConditionSchema }).strict();
export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;

export const IfElseDescriptor = defineNode({
    type: 'if-else',
    configSchema: IfElseConfigSchema,
    defaultConfig: {
        condition: {
            target: 'event',
            operator: 'equals',
            value: EventNameSchema.parse('file.created'),
        },
    },
});
