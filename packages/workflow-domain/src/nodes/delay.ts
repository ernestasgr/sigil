import { DelayConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

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
