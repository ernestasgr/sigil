import { z } from 'zod';

import { PipelineEdgeSchema } from './edges.js';
import { WorkflowIdSchema } from './ids.js';
import { PipelineNodeSchema } from './nodes/index.js';

export const CURRENT_WORKFLOW_DOCUMENT_VERSION = 1 as const;
export const WorkflowDocumentSchemaVersionSchema = z.literal(CURRENT_WORKFLOW_DOCUMENT_VERSION);
export type WorkflowDocumentSchemaVersion = z.infer<typeof WorkflowDocumentSchemaVersionSchema>;

/** The versioned persisted and transported shape of a user-authored Workflow. */
export const WorkflowDocumentSchema = z
    .object({
        id: z.string().min(1),
        workflowId: WorkflowIdSchema,
        schemaVersion: WorkflowDocumentSchemaVersionSchema,
        nodes: z.array(PipelineNodeSchema).readonly(),
        edges: z.array(PipelineEdgeSchema).readonly(),
    })
    .strict()
    .readonly();

export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

export interface WorkflowDocumentParseIssue {
    readonly path: readonly PropertyKey[];
    readonly message: string;
}

function flattenWorkflowDocumentIssue(
    issue: z.core.$ZodIssue,
    parentPath: readonly PropertyKey[] = [],
): readonly WorkflowDocumentParseIssue[] {
    const path = [...parentPath, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors.length > 0) {
        return issue.errors.flatMap((branch) =>
            branch.flatMap((nestedIssue) => flattenWorkflowDocumentIssue(nestedIssue, path)),
        );
    }
    return [{ path, message: issue.message }];
}

function parseIssueError(issues: readonly WorkflowDocumentParseIssue[]): string {
    return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
}

function malformedResult(
    error: string,
    issues: readonly WorkflowDocumentParseIssue[],
): WorkflowDocumentParseFailure {
    return { ok: false, reason: 'malformed', error, issues };
}

function readNumericSchemaVersion(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    try {
        const candidate = (value as Readonly<Record<string, unknown>>).schemaVersion;
        return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : undefined;
    } catch {
        return undefined;
    }
}

export type WorkflowDocumentParseFailure =
    | {
          readonly ok: false;
          readonly reason: 'malformed';
          readonly error: string;
          readonly issues: readonly WorkflowDocumentParseIssue[];
      }
    | {
          readonly ok: false;
          readonly reason: 'unsupported_version';
          readonly version: number;
          readonly error: string;
          readonly issues: readonly WorkflowDocumentParseIssue[];
      };

export type WorkflowDocumentParseResult =
    | { readonly ok: true; readonly value: WorkflowDocument }
    | WorkflowDocumentParseFailure;

/** Parse only the versioned structural document; this function never throws for bad input. */
export function parseWorkflowDocument(value: unknown): WorkflowDocumentParseResult {
    const version = readNumericSchemaVersion(value);
    if (version !== undefined && version > CURRENT_WORKFLOW_DOCUMENT_VERSION) {
        const issues: readonly WorkflowDocumentParseIssue[] = [
            {
                path: ['schemaVersion'],
                message:
                    `Workflow document version ${version} is not supported; ` +
                    `the current version is ${CURRENT_WORKFLOW_DOCUMENT_VERSION}.`,
            },
        ];
        return {
            ok: false,
            reason: 'unsupported_version',
            version,
            error: parseIssueError(issues),
            issues,
        };
    }

    try {
        const result = WorkflowDocumentSchema.safeParse(value);
        if (result.success) return { ok: true, value: result.data };
        const issues = result.error.issues.flatMap((issue) => flattenWorkflowDocumentIssue(issue));
        return malformedResult(parseIssueError(issues), issues);
    } catch (error: unknown) {
        const issue: WorkflowDocumentParseIssue = {
            path: [],
            message:
                error instanceof Error
                    ? error.message
                    : 'Workflow document could not be inspected safely.',
        };
        return malformedResult(issue.message, [issue]);
    }
}
