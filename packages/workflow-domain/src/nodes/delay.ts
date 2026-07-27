import { DelayDescriptor } from '@sigil/contracts/nodes/delay';

import { defineBuiltinNode } from './types.js';

export const DelayNode = defineBuiltinNode({
    ...DelayDescriptor,
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

export const DelayContractRegistration = DelayNode.registration;
