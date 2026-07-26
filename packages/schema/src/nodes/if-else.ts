import { z } from 'zod';

import { PipelineConditionSchema } from '../conditions.js';
import { defineNode, defineNodeRegistration } from './types.js';

export const IfElseConfigSchema = z.object({
    condition: PipelineConditionSchema,
});

export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;

export const IfElseDescriptor = defineNode({
    type: 'if-else',
    configSchema: IfElseConfigSchema,
    defaultConfig: {
        condition: { target: 'event', operator: 'equals', value: 'file.created' },
    },
});

export const IfElseContractRegistration = defineNodeRegistration(IfElseDescriptor, {
    identity: { namespace: 'builtin', type: 'if-else' },
    version: 1,
    role: 'action',
    outputPorts: {
        kind: 'fixed',
        ports: [
            { id: 'true', label: 'true' },
            { id: 'false', label: 'false' },
        ],
    },
    display: {
        label: 'If / Else',
        description: 'Branches the flow down a true or false path based on a condition.',
        category: 'logic',
    },
});
