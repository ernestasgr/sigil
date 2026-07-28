import { NotificationConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const NotificationNode = defineBuiltinNode({
    type: 'notification',
    configSchema: NotificationConfigSchema,
    defaultConfig: { title: 'Notification', body: 'Body' },
    contract: {
        identity: { namespace: 'builtin', type: 'notification' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'Notification',
            description: 'Shows an OS notification with a title and body.',
            category: 'system',
        },
    },
});
