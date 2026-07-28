import { StateGetConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const StateGetNode = defineBuiltinNode({
    type: 'state-get',
    configSchema: StateGetConfigSchema,
    defaultConfig: { key: 'key', assignTo: 'value' },
    contract: {
        identity: { namespace: 'builtin', type: 'state-get' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'State Get',
            description: 'Loads a value from workflow state into the workflow variables.',
            category: 'state',
        },
    },
});
