import { z } from 'zod';

import { defineBuiltinNode } from './types.js';

export const NotificationConfigSchema = z
    .object({
        title: z.string().min(1),
        body: z.string().min(1),
    })
    .strict();

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

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

export const NotificationDescriptor = NotificationNode.descriptor;
export const NotificationContractRegistration = NotificationNode.registration;
