import { z } from 'zod';

export const LogConfigSchema = z.object({ message: z.string().min(1) }).strict();
export type LogConfig = z.infer<typeof LogConfigSchema>;
