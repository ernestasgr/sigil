import { IfElseConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const IfElseNode = defineBuiltinNode({
    type: 'if-else',
    configSchema: IfElseConfigSchema,
    defaultConfig: {
        condition: {
            target: 'event',
            operator: 'equals',
            value: 'file.created',
        },
    },
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
