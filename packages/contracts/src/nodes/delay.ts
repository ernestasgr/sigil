import { z } from 'zod';

/** The largest delay that the platform timer scheduler can represent. */
export const MAX_DELAY_MS = 2_147_483_647 as const;

export const DelayConfigSchema = z
    .object({ ms: z.number().finite().int().min(0).max(MAX_DELAY_MS) })
    .strict();
export type DelayConfig = z.infer<typeof DelayConfigSchema>;
