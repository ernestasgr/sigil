import { IfElseDescriptor } from '@sigil/contracts/nodes/if-else';

import { defineBuiltinNode } from './types.js';

export const IfElseNode = defineBuiltinNode({
    ...IfElseDescriptor,
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

export const IfElseContractRegistration = IfElseNode.registration;
