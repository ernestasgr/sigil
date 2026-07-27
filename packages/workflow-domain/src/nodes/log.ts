import { LogDescriptor } from '@sigil/contracts/nodes/log';

import { defineBuiltinNode } from './types.js';

export const LogNode = defineBuiltinNode({
    ...LogDescriptor,
    contract: {
        identity: { namespace: 'builtin', type: 'log' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'Log',
            description: 'Emits a log line with a templated message.',
            category: 'utility',
        },
    },
});

export const LogContractRegistration = LogNode.registration;
