import { z } from 'zod';

import { defineNode, defineNodeRegistration } from './types.js';

export const DelayConfigSchema = z.object({
    ms: z.number().nonnegative(),
});

export type DelayConfig = z.infer<typeof DelayConfigSchema>;

export const DelayDescriptor = defineNode({
    type: 'delay',
    configSchema: DelayConfigSchema,
    defaultConfig: { ms: 1000 },
});

export const DelayContractRegistration = defineNodeRegistration(DelayDescriptor, {
    identity: { namespace: 'builtin', type: 'delay' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'Delay',
        description: 'Pauses the flow for a number of milliseconds.',
        category: 'utility',
    },
});
