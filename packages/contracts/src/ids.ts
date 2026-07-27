import { z } from 'zod';

/** Maximum UTF-16 code-unit length for a persisted or transported identity. */
export const MAX_CANONICAL_ID_LENGTH = 128;

const LOWERCASE_KEBAB_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOWERCASE_NAMESPACED_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

function canonicalIdentitySchema(pattern: RegExp, subject: string): z.ZodString {
    return z
        .string()
        .min(1, `${subject} must not be empty.`)
        .max(
            MAX_CANONICAL_ID_LENGTH,
            `${subject} must be at most ${MAX_CANONICAL_ID_LENGTH} characters.`,
        )
        .refine((value) => value === value.trim(), {
            message: `${subject} must not have leading or trailing whitespace.`,
        })
        .refine(
            (value) =>
                Array.from(value).every((character) => {
                    const codePoint = character.codePointAt(0) ?? 0;
                    return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
                }),
            {
                message: `${subject} must not contain control characters.`,
            },
        )
        .regex(pattern, {
            message: `${subject} must use its canonical lowercase form.`,
        });
}

/** The identity of a concrete node instance in a Pipeline graph. */
export const PipelineNodeIdSchema = canonicalIdentitySchema(
    LOWERCASE_KEBAB_PATTERN,
    'Pipeline Node ID',
).brand<'PipelineNodeId'>();
export type PipelineNodeId = z.infer<typeof PipelineNodeIdSchema>;

/** The identity of a concrete Edge instance in a Pipeline graph. */
export const PipelineEdgeIdSchema = canonicalIdentitySchema(
    LOWERCASE_KEBAB_PATTERN,
    'Pipeline Edge ID',
).brand<'PipelineEdgeId'>();
export type PipelineEdgeId = z.infer<typeof PipelineEdgeIdSchema>;

/** The stable identity of a Node Contract output port. */
export const NodeOutputPortIdSchema = canonicalIdentitySchema(
    LOWERCASE_KEBAB_PATTERN,
    'Node output port ID',
).brand<'NodeOutputPortId'>();
export type NodeOutputPortId = z.infer<typeof NodeOutputPortIdSchema>;

/** The stable identity of an editable Switch case. */
export const SwitchCaseIdSchema = canonicalIdentitySchema(
    LOWERCASE_KEBAB_PATTERN,
    'Switch case ID',
).brand<'SwitchCaseId'>();
export type SwitchCaseId = z.infer<typeof SwitchCaseIdSchema>;

/** The unique identifier of a Plugin (e.g. "com.sigil.file-watcher"). */
export const PluginIdSchema = canonicalIdentitySchema(
    LOWERCASE_NAMESPACED_PATTERN,
    'Plugin ID',
).brand<'PluginId'>();
export type PluginId = z.infer<typeof PluginIdSchema>;

/** The canonical lowercase dot-separated name of an Event. */
export const EventNameSchema = canonicalIdentitySchema(
    LOWERCASE_NAMESPACED_PATTERN,
    'Event name',
).brand<'EventName'>();
export type EventName = z.infer<typeof EventNameSchema>;

/** Runtime-only canonical Event validation for transient context values. */
export const CanonicalEventNameSchema = z
    .string()
    .refine((value) => EventNameSchema.safeParse(value).success, {
        message: 'Event name must use its canonical lowercase dot-separated form.',
    });

/** The canonical lowercase kebab-case name of a Node type. */
export const NodeTypeNameSchema = canonicalIdentitySchema(
    LOWERCASE_KEBAB_PATTERN,
    'Node type name',
).brand<'NodeTypeName'>();
export type NodeTypeName = z.infer<typeof NodeTypeNameSchema>;

/** Runtime-only canonical Node type validation for structural Pipeline values. */
export const CanonicalNodeTypeNameSchema = z
    .string()
    .refine((value) => NodeTypeNameSchema.safeParse(value).success, {
        message: 'Node type name must use its canonical lowercase kebab-case form.',
    });

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const WorkflowIdSchema = z
    .string()
    .min(1, 'Workflow id must not be empty.')
    .max(128, 'Workflow id must be at most 128 characters.')
    .regex(
        WORKFLOW_ID_PATTERN,
        'Workflow id must contain only letters, numbers, hyphens, and underscores, and start with a letter or number.',
    )
    .brand<'WorkflowId'>();

export type WorkflowId = z.infer<typeof WorkflowIdSchema>;
