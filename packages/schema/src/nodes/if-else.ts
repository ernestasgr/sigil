import { z } from 'zod';

import { PipelineConditionSchema } from '../conditions.js';
import { EventNameSchema } from '../ids.js';
import { defineBuiltinNode } from './types.js';

export const IfElseConfigSchema = z
    .object({
        condition: PipelineConditionSchema,
    })
    .strict();

export type IfElseConfig = z.infer<typeof IfElseConfigSchema>;

export const IfElseNode = defineBuiltinNode({
    type: 'if-else',
    configSchema: IfElseConfigSchema,
    defaultConfig: {
        condition: {
            target: 'event',
            operator: 'equals',
            value: EventNameSchema.parse('file.created'),
        },
    },
    contract: {
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
    },
});

export const IfElseDescriptor = IfElseNode.descriptor;
export const IfElseContractRegistration = IfElseNode.registration;
