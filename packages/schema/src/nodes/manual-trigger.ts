import { z } from 'zod';
import { FileEventNameSchema } from '../event-catalog.js';
import { FileEventPayloadSchema } from '../file-event-payload.js';
import { defineNode, defineNodeRegistration } from './types.js';

export const ManualTriggerConfigSchema = z.object({
    eventName: FileEventNameSchema,
    payload: FileEventPayloadSchema,
});

export type ManualTriggerConfig = z.infer<typeof ManualTriggerConfigSchema>;

export const ManualTriggerDescriptor = defineNode({
    type: 'manual-trigger',
    configSchema: ManualTriggerConfigSchema,
    defaultConfig: {
        eventName: 'file.created',
        payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
    },
});

export const ManualTriggerContractRegistration = defineNodeRegistration(ManualTriggerDescriptor, {
    identity: { namespace: 'builtin', type: 'manual-trigger' },
    version: 1,
    role: 'trigger',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'Manual Trigger',
        description:
            'Fires a single event with a hand-crafted payload, for testing and manual runs.',
        category: 'trigger',
    },
});
