import { z } from 'zod';

import { defineBuiltinNode } from './types.js';

export const LogConfigSchema = z
    .object({
        message: z.string().min(1),
    })
    .strict();

export type LogConfig = z.infer<typeof LogConfigSchema>;

export const LogNode = defineBuiltinNode({
    type: 'log',
    configSchema: LogConfigSchema,
    defaultConfig: { message: 'Log message' },
    contract: {
        identity: { namespace: 'builtin', type: 'log' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'Log',
            description: 'Emits a log line with a templated message.',
            category: 'utility',
        },
    },
});

export const LogDescriptor = LogNode.descriptor;
export const LogContractRegistration = LogNode.registration;
