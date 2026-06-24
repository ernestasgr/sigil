import { z } from 'zod';

import { defineNode } from './types.js';

export const LogConfigSchema = z.object({
    message: z.string().min(1),
});

export type LogConfig = z.infer<typeof LogConfigSchema>;

export const LogDescriptor = defineNode({
    type: 'log',
    configSchema: LogConfigSchema,
    defaultConfig: { message: 'Log message' },
    getOutputPorts: () => ['out'],
});
