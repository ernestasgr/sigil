import { z } from 'zod';

import { defineBuiltinNode } from './types.js';

export const StateGetConfigSchema = z
    .object({
        key: z.string().min(1),
        assignTo: z.string().min(1),
    })
    .strict();

export type StateGetConfig = z.infer<typeof StateGetConfigSchema>;

export const StateGetNode = defineBuiltinNode({
    type: 'state-get',
    configSchema: StateGetConfigSchema,
    defaultConfig: { key: 'key', assignTo: 'value' },
    contract: {
        identity: { namespace: 'builtin', type: 'state-get' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'State Get',
            description: 'Loads a value from workflow state into the workflow variables.',
            category: 'state',
        },
    },
});

export const StateGetDescriptor = StateGetNode.descriptor;
export const StateGetContractRegistration = StateGetNode.registration;
