import { z } from 'zod';

import { PipelineEdgeSchema } from './edges.js';
import { WorkflowIdSchema } from './ids.js';
import type { NodeIdentity, NodeOutputPort, NodeRole } from './node-contract.js';
import { PipelineNodeSchema } from './nodes/index.js';
import {
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from './topology.js';

export const CURRENT_WORKFLOW_DOCUMENT_VERSION = 1 as const;
export const WorkflowDocumentSchemaVersionSchema = z.literal(CURRENT_WORKFLOW_DOCUMENT_VERSION);
export type WorkflowDocumentSchemaVersion = z.infer<typeof WorkflowDocumentSchemaVersionSchema>;

/**
 * The persisted and transported graph shape. Referential integrity, contract
 * admission, and DAG rules belong to compilation so editors can represent
 * structurally valid drafts without treating them as executable.
 */
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

export interface AdmittedNodeContract {
    readonly nodeId: WorkflowDocument['nodes'][number]['id'];
    readonly identity: NodeIdentity;
    readonly version: number;
    readonly role: NodeRole;
    readonly outputPorts: readonly NodeOutputPort[] | 'dynamic';
}

export interface CompiledPipeline extends WorkflowDocument {
    /** The exact structural document from which this executable value came. */
    readonly source: WorkflowDocument;
    /** The single Trigger admitted as the Workflow entry point. */
    readonly triggerId: WorkflowDocument['nodes'][number]['id'];
    /** Deterministic topological order admitted for execution. */
    readonly executionOrder: readonly WorkflowDocument['nodes'][number]['id'][];
    /** Contract facts resolved during admission; executor code does not re-admit Nodes. */
    readonly admittedNodeContracts: readonly AdmittedNodeContract[];
}

export type WorkflowCompilationOptions = Omit<WorkflowTopologyOptions, 'requireNodeContracts'>;

export type WorkflowCompilationResult =
    | {
          readonly ok: true;
          readonly value: CompiledPipeline;
          readonly diagnostics: readonly TopologyDiagnostic[];
      }
    | {
          readonly ok: false;
          readonly error: string;
          readonly diagnostics: readonly TopologyDiagnostic[];
          readonly phase: 'parsing';
          readonly parseFailure: WorkflowDocumentParseFailure;
      }
    | {
          readonly ok: false;
          readonly error: string;
          readonly diagnostics: readonly TopologyDiagnostic[];
          readonly phase: 'admission';
      };

function structuralDiagnostic(failure: WorkflowDocumentParseFailure): TopologyDiagnostic {
    return {
        severity: 'error',
        code:
            failure.reason === 'unsupported_version'
                ? 'unsupported_document_version'
                : 'invalid_pipeline',
        target: { kind: 'pipeline' },
        message: `Workflow document is ${failure.reason === 'unsupported_version' ? 'unsupported' : 'malformed'}: ${failure.error}`,
    };
}

/**
 * The only public admission interface for execution. It parses unknown input,
 * resolves Node Contracts, validates topology and runtime support, and creates
 * the immutable execution plan consumed by the Engine.
 */
export function compileWorkflow(
    input: unknown,
    options: WorkflowCompilationOptions = {},
): WorkflowCompilationResult {
    const parsed = parseWorkflowDocument(input);
    if (!parsed.ok) {
        const diagnostic = structuralDiagnostic(parsed);
        return {
            ok: false,
            error: formatTopologyDiagnostics([diagnostic]),
            diagnostics: [diagnostic],
            phase: 'parsing',
            parseFailure: parsed,
        };
    }

    const topology = validateWorkflowTopology(parsed.value, {
        ...options,
        requireNodeContracts: true,
    });
    if (!topology.ok) {
        return {
            ok: false,
            error: formatTopologyDiagnostics(topology.diagnostics),
            diagnostics: topology.diagnostics,
            phase: 'admission',
        };
    }

    const value: CompiledPipeline = Object.freeze({
        ...parsed.value,
        source: parsed.value,
        triggerId: topology.value.triggerId,
        executionOrder: Object.freeze([...topology.value.executionOrder]),
        admittedNodeContracts: Object.freeze(
            topology.value.admittedNodeContracts.map((contract) => Object.freeze(contract)),
        ),
    });
    return { ok: true, value, diagnostics: [] };
}

export type { NodeOutputPortId, PipelineEdgeId, PipelineNodeId } from './ids.js';
export { NodeOutputPortIdSchema, PipelineEdgeIdSchema, PipelineNodeIdSchema } from './ids.js';
export type {
    CompiledMatchPattern,
    MatchPatternComparison,
    MatchPatternCompilation,
    MatchPatternEngine,
    MatchPatternFlag,
    MatchPatternIssue,
    MatchPatternIssueCode,
    MatchPatternValidation,
    ParsedMatchPattern,
} from './match-pattern.js';
export {
    compareMatchPattern,
    createRe2MatchPatternEngine,
    DEFAULT_MATCH_PATTERN_ENGINE,
    MATCH_PATTERN_SUPPORTED_FLAGS,
    MAX_MATCH_CANDIDATE_LENGTH,
    MAX_MATCH_PATTERN_LENGTH,
    parseMatchPattern,
    validateMatchPattern,
} from './match-pattern.js';
export type {
    TopologyDiagnostic,
    TopologyDiagnosticCode,
    TopologyDiagnosticSeverity,
    WorkflowTopologyOptions,
    WorkflowTopologyResult,
} from './topology.js';
export { formatTopologyDiagnostics, validateWorkflowTopology } from './topology.js';
