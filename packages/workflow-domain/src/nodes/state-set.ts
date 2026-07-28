import { StateSetConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const StateSetNode = defineBuiltinNode({
    type: 'state-set',
    configSchema: StateSetConfigSchema,
    defaultConfig: { key: 'key', valueTemplate: '', valueType: 'string' },
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
