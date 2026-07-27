import { z } from 'zod';

import { FileEventNameSchema } from '../event-catalog.js';
import { defineNode } from './types.js';

export const FileWatcherConfigSchema = z
    .object({
        path: z.string().min(1),
        recursive: z.boolean(),
        events: z.array(FileEventNameSchema).min(1),
        ignorePatterns: z.array(z.string()).optional(),
    })
    .strict();
export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;

export const FileWatcherDescriptor = defineNode({
    type: 'file-watcher',
    configSchema: FileWatcherConfigSchema,
    defaultConfig: {
        path: '/',
        recursive: true,
        events: [FileEventNameSchema.parse('file.created')],
    },
});
