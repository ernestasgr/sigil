import { z } from 'zod';

import { EventNameSchema, NodeTypeNameSchema, PluginIdSchema } from './ids.js';
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
        id: PluginIdSchema,
        version: z.string().min(1),
        permissions: z.array(CapabilitySchema),
        emits: z.array(EventNameSchema).min(1),
        nodeType: NodeTypeNameSchema.optional(),
        /** Plain-data Node Contract; runtime functions remain inside the worker. */
        nodeContract: SerializableNodeContractSchema.optional(),
    })
    .strict()
    .superRefine((manifest, ctx) => {
        const eventIndexes = new Map<string, number>();
        for (const [index, eventName] of manifest.emits.entries()) {
            const previousIndex = eventIndexes.get(eventName);
            if (previousIndex !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['emits', index],
                    message: `Event name "${eventName}" is declared more than once (first declared at index ${previousIndex}).`,
                });
            } else {
                eventIndexes.set(eventName, index);
            }
        }

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

export interface ManifestParseIssue {
    readonly path: readonly PropertyKey[];
    readonly message: string;
}

export type ManifestParseError = {
    readonly ok: false;
    readonly error: string;
    readonly issues: readonly ManifestParseIssue[];
};
export type ManifestParseOk = { readonly ok: true; readonly value: Manifest };
export type ManifestParseResult = ManifestParseOk | ManifestParseError;

export function parseManifest(unknown: unknown): ManifestParseResult {
    let result: ReturnType<typeof ManifestSchema.safeParse>;
    try {
        result = ManifestSchema.safeParse(unknown);
    } catch {
        return {
            ok: false,
            error: 'Manifest could not be validated safely.',
            issues: [],
        };
    }
    if (result.success) {
        return { ok: true, value: result.data };
    }
    return {
        ok: false,
        error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        issues: result.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
        })),
    };
}
