import { FileWatcherConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const FileWatcherNode = defineBuiltinNode({
    type: 'file-watcher',
    configSchema: FileWatcherConfigSchema,
    defaultConfig: {
        path: '/',
        recursive: true,
        events: ['file.created'],
    },
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
