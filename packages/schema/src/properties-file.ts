import { z } from 'zod';

export const CollisionSuffixStyleSchema = z.enum(['windows', 'underscore', 'hyphen']);
export type CollisionSuffixStyle = z.infer<typeof CollisionSuffixStyleSchema>;

export const PropertiesFileSchema = z
    .object({
        notifyOnWorkflowError: z.boolean().optional(),
        databasePath: z.string().optional(),
        collisionSuffixStyle: CollisionSuffixStyleSchema.optional(),
    })
    .passthrough();

export type PropertiesFile = z.infer<typeof PropertiesFileSchema>;

export interface ResolvedProperties {
    readonly notifyOnWorkflowError: boolean;
    readonly databasePath: string;
    readonly collisionSuffixStyle: CollisionSuffixStyle;
}

export const DEFAULT_PROPERTIES: Readonly<ResolvedProperties> = {
    notifyOnWorkflowError: true,
    databasePath: ':memory:',
    collisionSuffixStyle: 'windows',
};

export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
    '*.crdownload',
    '*.part',
    '*.tmp',
    '*.download',
];

export function loadPropertiesFile(
    unknown: unknown,
    defaults: Partial<ResolvedProperties> = {},
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
    const merged = { ...DEFAULT_PROPERTIES, ...defaults };
    return {
        ok: true,
        value: {
            notifyOnWorkflowError:
                result.data.notifyOnWorkflowError ?? merged.notifyOnWorkflowError,
            databasePath: result.data.databasePath ?? merged.databasePath,
            collisionSuffixStyle: result.data.collisionSuffixStyle ?? merged.collisionSuffixStyle,
        },
    };
}
