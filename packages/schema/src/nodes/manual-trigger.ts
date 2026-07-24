import { z } from 'zod';
import { FileEventNameSchema } from '../event-catalog.js';
import { FileEventPayloadSchema } from '../file-event-payload.js';
import { defineNode } from './types.js';

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
    getOutputPorts: () => ['out'],
});
