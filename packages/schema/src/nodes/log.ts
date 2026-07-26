import { z } from 'zod';

import { defineNode, defineNodeRegistration } from './types.js';

export const LogConfigSchema = z.object({
    message: z.string().min(1),
});

export type LogConfig = z.infer<typeof LogConfigSchema>;

export const LogDescriptor = defineNode({
    type: 'log',
    configSchema: LogConfigSchema,
    defaultConfig: { message: 'Log message' },
});

export const LogContractRegistration = defineNodeRegistration(LogDescriptor, {
    identity: { namespace: 'builtin', type: 'log' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'Log',
        description: 'Emits a log line with a templated message.',
        category: 'utility',
    },
});
