import { z } from 'zod';

import { defineNode } from './types.js';

const EventNameSwitchSchema = z.object({
    target: z.literal('event'),
    cases: z.array(z.string().min(1)),
});

const FieldSwitchSchema = z.object({
    target: z.enum(['payload', 'vars']),
    field: z.string().min(1),
    cases: z.array(z.string().min(1)),
});

export const SwitchConfigSchema = z
    .union([EventNameSwitchSchema, FieldSwitchSchema])
    .refine((cfg) => new Set(cfg.cases).size === cfg.cases.length, {
        message: 'switch cases must be unique',
        path: ['cases'],
    })
    .refine((cfg) => !cfg.cases.includes('default'), {
        message: "'default' is reserved and cannot be used as a case label",
        path: ['cases'],
    });

export type SwitchConfig = z.infer<typeof SwitchConfigSchema>;

export const SwitchDescriptor = defineNode({
    type: 'switch',
    configSchema: SwitchConfigSchema,
    defaultConfig: { target: 'event', cases: ['file.created'] },
    getOutputPorts: (config) => {
        const { cases } = config as SwitchConfig;
        return ['default', ...cases];
    },
});
