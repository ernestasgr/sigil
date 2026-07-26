import { z } from 'zod';

import { defineBuiltinNode } from './types.js';

/** The largest delay Node's setTimeout scheduler can represent without clamping. */
export const MAX_DELAY_MS = 2_147_483_647 as const;

export const DelayConfigSchema = z
    .object({
        ms: z.number().finite().int().min(0).max(MAX_DELAY_MS),
    })
    .strict();

export type DelayConfig = z.infer<typeof DelayConfigSchema>;

export const DelayNode = defineBuiltinNode({
    type: 'delay',
    configSchema: DelayConfigSchema,
    defaultConfig: { ms: 1000 },
    contract: {
        identity: { namespace: 'builtin', type: 'delay' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'Delay',
            description: 'Pauses the flow for a number of milliseconds.',
            category: 'utility',
        },
    },
});

export const DelayDescriptor = DelayNode.descriptor;
export const DelayContractRegistration = DelayNode.registration;
