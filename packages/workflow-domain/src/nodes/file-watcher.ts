import { FileWatcherDescriptor } from '@sigil/contracts/nodes/file-watcher';

import { defineBuiltinNode } from './types.js';

export const FileWatcherNode = defineBuiltinNode({
    ...FileWatcherDescriptor,
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

export const FileWatcherContractRegistration = FileWatcherNode.registration;
