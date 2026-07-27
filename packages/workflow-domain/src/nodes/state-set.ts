import { StateSetDescriptor } from '@sigil/contracts/nodes/state-set';

import { defineBuiltinNode } from './types.js';

export const StateSetNode = defineBuiltinNode({
    ...StateSetDescriptor,
    contract: {
        identity: { namespace: 'builtin', type: 'state-set' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'State Set',
            description: 'Writes a templated value into workflow state under a key.',
            category: 'state',
        },
    },
});

export const StateSetContractRegistration = StateSetNode.registration;
