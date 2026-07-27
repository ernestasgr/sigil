import { ManualTriggerDescriptor } from '@sigil/contracts/nodes/manual-trigger';

import { defineBuiltinNode } from './types.js';

export const ManualTriggerNode = defineBuiltinNode({
    ...ManualTriggerDescriptor,
    contract: {
        identity: { namespace: 'builtin', type: 'manual-trigger' },
        version: 1,
        role: 'trigger',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'Manual Trigger',
            description:
                'Fires a single event with a hand-crafted payload, for testing and manual runs.',
            category: 'trigger',
        },
    },
});

export const ManualTriggerContractRegistration = ManualTriggerNode.registration;
