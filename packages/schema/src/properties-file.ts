import { z } from 'zod';

export const PropertiesFileSchema = z
    .object({
        notifyOnWorkflowError: z.boolean().optional(),
    })
    .passthrough();

export type PropertiesFile = z.infer<typeof PropertiesFileSchema>;

export interface ResolvedProperties {
    readonly notifyOnWorkflowError: boolean;
}

export const DEFAULT_PROPERTIES: Readonly<ResolvedProperties> = {
    notifyOnWorkflowError: true,
};

export function loadPropertiesFile(
    unknown: unknown,
):
    | { readonly ok: true; readonly value: ResolvedProperties }
    | { readonly ok: false; readonly error: string } {
    const result = PropertiesFileSchema.safeParse(unknown);
    if (!result.success) {
        return {
            ok: false,
            error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        };
    }
    return {
        ok: true,
        value: {
            notifyOnWorkflowError:
                result.data.notifyOnWorkflowError ?? DEFAULT_PROPERTIES.notifyOnWorkflowError,
        },
    };
}
