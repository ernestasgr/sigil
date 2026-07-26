import { z } from 'zod';
import { FileEventNameSchema } from '../event-catalog.js';
import { defineNode, defineNodeRegistration } from './types.js';

export const FileWatcherConfigSchema = z.object({
    path: z.string().min(1),
    recursive: z.boolean(),
    events: z.array(FileEventNameSchema).min(1),
    ignorePatterns: z.array(z.string()).optional(),
});

export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;

export const FileWatcherDescriptor = defineNode({
    type: 'file-watcher',
    configSchema: FileWatcherConfigSchema,
    defaultConfig: { path: '/', recursive: true, events: ['file.created'] },
});

export const FileWatcherContractRegistration = defineNodeRegistration(FileWatcherDescriptor, {
    identity: { namespace: 'builtin', type: 'file-watcher' },
    version: 1,
    role: 'trigger',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'File Watcher',
        description:
            'Emits an event when files are created, modified, or deleted in a watched path.',
        category: 'trigger',
    },
});
