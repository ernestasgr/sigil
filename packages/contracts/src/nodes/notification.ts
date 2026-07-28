import { z } from 'zod';

export const NotificationConfigSchema = z
    .object({ title: z.string().min(1), body: z.string().min(1) })
    .strict();
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
