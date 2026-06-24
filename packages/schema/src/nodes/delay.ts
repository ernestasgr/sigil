import { z } from 'zod';

import { defineNode } from './types.js';

export const DelayConfigSchema = z.object({
    ms: z.number().nonnegative(),
});

export type DelayConfig = z.infer<typeof DelayConfigSchema>;

export const DelayDescriptor = defineNode({
    type: 'delay',
    configSchema: DelayConfigSchema,
    defaultConfig: { ms: 1000 },
    getOutputPorts: () => ['out'],
});
