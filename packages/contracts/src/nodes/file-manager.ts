import { z } from 'zod';

import { ConflictPolicySchema } from '../properties-file.js';

export const FileManagerConfigSchema = z
    .object({
        action: z.enum(['move', 'rename', 'copy']),
        destination: z.string().min(1),
        onConflict: ConflictPolicySchema.optional(),
    })
    .strict();
export type FileManagerConfig = z.infer<typeof FileManagerConfigSchema>;
