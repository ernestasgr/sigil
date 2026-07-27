import { z } from 'zod';

import { defineNode } from './types.js';

export const NotificationConfigSchema = z
    .object({ title: z.string().min(1), body: z.string().min(1) })
    .strict();
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export const NotificationDescriptor = defineNode({
    type: 'notification',
    configSchema: NotificationConfigSchema,
    defaultConfig: { title: 'Notification', body: 'Body' },
});
