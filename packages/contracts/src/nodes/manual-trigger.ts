import { z } from 'zod';

import { FileEventNameSchema } from '../event-catalog.js';
import { FileEventPayloadSchema } from '../file-event-payload.js';

export const ManualTriggerConfigSchema = z
    .object({ eventName: FileEventNameSchema, payload: FileEventPayloadSchema })
    .strict();
export type ManualTriggerConfig = z.infer<typeof ManualTriggerConfigSchema>;
