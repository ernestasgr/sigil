import { z } from 'zod';
import { FileEventNameSchema } from '../event-catalog.js';
import { defineBuiltinNode } from './types.js';

export const FileWatcherConfigSchema = z
    .object({
        path: z.string().min(1),
        recursive: z.boolean(),
        events: z.array(FileEventNameSchema).min(1),
        ignorePatterns: z.array(z.string()).optional(),
    })
    .strict();

export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>;

export const FileWatcherNode = defineBuiltinNode({
    type: 'file-watcher',
    configSchema: FileWatcherConfigSchema,
    defaultConfig: { path: '/', recursive: true, events: ['file.created'] },
    contract: {
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
    },
});

export const FileWatcherDescriptor = FileWatcherNode.descriptor;
export const FileWatcherContractRegistration = FileWatcherNode.registration;
