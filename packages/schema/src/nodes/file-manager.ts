import { z } from 'zod';

import { ConflictPolicySchema } from '../properties-file.js';
import { defineNode } from './types.js';

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
    getOutputPorts: () => ['out'],
});
