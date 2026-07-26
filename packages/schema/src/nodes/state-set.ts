import { z } from 'zod';

import { defineNode, defineNodeRegistration } from './types.js';

export const STATE_SET_VALUE_TYPES = ['string', 'number', 'boolean'] as const;
export const StateSetValueTypeSchema = z.enum(STATE_SET_VALUE_TYPES);
export type StateSetValueType = z.infer<typeof StateSetValueTypeSchema>;

export const StateSetConfigSchema = z.object({
    key: z.string().min(1),
    valueTemplate: z.string(),
    valueType: StateSetValueTypeSchema.default('string'),
});

export type StateSetConfig = z.infer<typeof StateSetConfigSchema>;

export const StateSetDescriptor = defineNode({
    type: 'state-set',
    configSchema: StateSetConfigSchema,
    defaultConfig: { key: 'key', valueTemplate: '', valueType: 'string' },
});

export const StateSetContractRegistration = defineNodeRegistration(StateSetDescriptor, {
    identity: { namespace: 'builtin', type: 'state-set' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'State Set',
        description: 'Writes a templated value into workflow state under a key.',
        category: 'state',
    },
});
