import { z } from 'zod';

import { defineNode } from './types.js';

export const StateSetConfigSchema = z.object({
    key: z.string().min(1),
    valueTemplate: z.string(),
});

export type StateSetConfig = z.infer<typeof StateSetConfigSchema>;

export const StateSetDescriptor = defineNode({
    type: 'state-set',
    configSchema: StateSetConfigSchema,
    defaultConfig: { key: 'key', valueTemplate: '' },
    getOutputPorts: () => ['out'],
});
