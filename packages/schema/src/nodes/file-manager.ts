import { z } from 'zod';

import { ConflictPolicySchema } from '../properties-file.js';
import { defineBuiltinNode } from './types.js';

export const FileManagerConfigSchema = z
    .object({
        action: z.enum(['move', 'rename', 'copy']),
        destination: z.string().min(1),
        onConflict: ConflictPolicySchema.optional(),
    })
    .strict();

export type FileManagerConfig = z.infer<typeof FileManagerConfigSchema>;

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

export const FileManagerDescriptor = FileManagerNode.descriptor;
export const FileManagerContractRegistration = FileManagerNode.registration;
