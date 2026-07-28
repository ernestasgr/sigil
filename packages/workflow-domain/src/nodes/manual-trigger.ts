import { ManualTriggerConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const ManualTriggerNode = defineBuiltinNode({
    type: 'manual-trigger',
    configSchema: ManualTriggerConfigSchema,
    defaultConfig: {
        eventName: 'file.created',
        payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
    },
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
