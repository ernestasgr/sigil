import { z } from 'zod';

import { ConflictPolicySchema } from '../properties-file.js';
import { defineNode, defineNodeRegistration } from './types.js';

export const FileManagerConfigSchema = z.object({
    action: z.enum(['move', 'rename', 'copy']),
    destination: z.string().min(1),
    onConflict: ConflictPolicySchema.optional(),
});

export type FileManagerConfig = z.infer<typeof FileManagerConfigSchema>;

export const FileManagerDescriptor = defineNode({
    type: 'file-manager',
    configSchema: FileManagerConfigSchema,
    defaultConfig: { action: 'move', destination: '/', onConflict: 'skip' },
});

export const FileManagerContractRegistration = defineNodeRegistration(FileManagerDescriptor, {
    identity: { namespace: 'builtin', type: 'file-manager' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: {
        label: 'File Manager',
        description: 'Moves, renames, or copies the file carried by the incoming event.',
        category: 'system',
    },
});
