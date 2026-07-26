import { z } from 'zod';

import { defineNode, defineNodeRegistration } from './types.js';

export const NotificationConfigSchema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export const NotificationDescriptor = defineNode({
    type: 'notification',
    configSchema: NotificationConfigSchema,
    defaultConfig: { title: 'Notification', body: 'Body' },
});

export const NotificationContractRegistration = defineNodeRegistration(NotificationDescriptor, {
    identity: { namespace: 'builtin', type: 'notification' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'Notification',
        description: 'Shows an OS notification with a title and body.',
        category: 'system',
    },
});
