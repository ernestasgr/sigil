import { z } from 'zod';

import { defineNode, defineNodeRegistration } from './types.js';

export const StateGetConfigSchema = z.object({
    key: z.string().min(1),
    assignTo: z.string().min(1),
});

export type StateGetConfig = z.infer<typeof StateGetConfigSchema>;

export const StateGetDescriptor = defineNode({
    type: 'state-get',
    configSchema: StateGetConfigSchema,
    defaultConfig: { key: 'key', assignTo: 'value' },
});

export const StateGetContractRegistration = defineNodeRegistration(StateGetDescriptor, {
    identity: { namespace: 'builtin', type: 'state-get' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'State Get',
        description: 'Loads a value from workflow state into the workflow variables.',
        category: 'state',
    },
});
