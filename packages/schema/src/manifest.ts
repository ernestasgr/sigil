import { z } from 'zod';

export const CapabilitySchema = z.enum([
    'state.read',
    'state.write',
    'filesystem.read',
    'filesystem.write',
    'network',
    'clipboard',
    'processes',
    'display',
    'keyboard.global',
    'microphone',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const ManifestSchema = z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    permissions: z.array(CapabilitySchema),
    emits: z.array(z.string().min(1)).min(1),
    nodeType: z.string().min(1).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export type ManifestParseError = { readonly ok: false; readonly error: string };
export type ManifestParseOk = { readonly ok: true; readonly value: Manifest };
export type ManifestParseResult = ManifestParseOk | ManifestParseError;

export function parseManifest(unknown: unknown): ManifestParseResult {
    const result = ManifestSchema.safeParse(unknown);
    if (result.success) {
        return { ok: true, value: result.data };
    }
    return {
        ok: false,
        error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
    };
}
