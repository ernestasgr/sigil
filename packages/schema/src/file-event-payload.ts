import { z } from 'zod';

export const FileEventPayloadSchema = z.object({
    path: z.string().min(1),
    name: z.string(),
    ext: z.string(),
    size: z.number().int().nonnegative(),
    dir: z.string(),
});
export type FileEventPayload = z.infer<typeof FileEventPayloadSchema>;
