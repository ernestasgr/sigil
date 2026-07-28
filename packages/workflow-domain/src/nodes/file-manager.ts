import { FileManagerConfigSchema } from '@sigil/contracts/workflow';

import { defineBuiltinNode } from './types.js';

export const FileManagerNode = defineBuiltinNode({
    type: 'file-manager',
    configSchema: FileManagerConfigSchema,
    defaultConfig: { action: 'move', destination: '/', onConflict: 'skip' },
    contract: {
        identity: { namespace: 'builtin', type: 'file-manager' },
        version: 1,
        role: 'action',
        outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
        display: {
            label: 'File Manager',
            description: 'Moves, renames, or copies the file carried by the incoming event.',
            category: 'system',
        },
    },
});
