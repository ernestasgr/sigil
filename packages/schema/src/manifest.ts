import { z } from 'zod';

import { SerializableNodeContractSchema } from './node-contract.js';

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

export const ManifestSchema = z
    .object({
        id: z.string().min(1),
        version: z.string().min(1),
        permissions: z.array(CapabilitySchema),
        emits: z.array(z.string().min(1)).min(1),
        nodeType: z.string().min(1).optional(),
        /** Plain-data Node Contract; runtime functions remain inside the worker. */
        nodeContract: SerializableNodeContractSchema.optional(),
    })
    .superRefine((manifest, ctx) => {
        if (!manifest.nodeContract) return;

        if (manifest.nodeType === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['nodeContract'],
                message: 'A Node Contract requires a manifest nodeType.',
            });
            return;
        }

        const { identity } = manifest.nodeContract;
        if (identity.namespace !== 'plugin') {
            ctx.addIssue({
                code: 'custom',
                path: ['nodeContract', 'identity', 'namespace'],
                message: 'Plugin manifests must declare a Plugin Node Contract identity.',
            });
            return;
        }
        if (identity.pluginId !== manifest.id) {
            ctx.addIssue({
                code: 'custom',
                path: ['nodeContract', 'identity', 'pluginId'],
                message: 'Node Contract identity pluginId must match the manifest id.',
            });
        }
        if (identity.type !== manifest.nodeType) {
            ctx.addIssue({
                code: 'custom',
                path: ['nodeContract', 'identity', 'type'],
                message: 'Node Contract identity type must match the manifest nodeType.',
            });
        }
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
