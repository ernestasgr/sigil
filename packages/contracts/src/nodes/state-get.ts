import { z } from 'zod';

export const StateGetConfigSchema = z
    .object({ key: z.string().min(1), assignTo: z.string().min(1) })
    .strict();
export type StateGetConfig = z.infer<typeof StateGetConfigSchema>;
