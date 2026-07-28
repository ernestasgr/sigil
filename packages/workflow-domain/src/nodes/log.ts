import { LogConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const LogNode = defineBuiltinNode({
    type: 'log',
    configSchema: LogConfigSchema,
    defaultConfig: { message: 'Log message' },
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
