import { z } from 'zod';

import { defineNode } from './types.js';

export const StateGetConfigSchema = z.object({
    key: z.string().min(1),
    assignTo: z.string().min(1),
});

export type StateGetConfig = z.infer<typeof StateGetConfigSchema>;

export const StateGetDescriptor = defineNode({
    type: 'state-get',
    configSchema: StateGetConfigSchema,
    defaultConfig: { key: 'key', assignTo: 'value' },
    getOutputPorts: () => ['out'],
});
