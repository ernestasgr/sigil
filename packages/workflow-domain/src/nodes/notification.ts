import { NotificationDescriptor } from '@sigil/contracts/nodes/notification';

import { defineBuiltinNode } from './types.js';

export const NotificationNode = defineBuiltinNode({
    ...NotificationDescriptor,
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

export const NotificationContractRegistration = NotificationNode.registration;
