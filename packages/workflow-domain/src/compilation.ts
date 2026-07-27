import {
    parseWorkflowDocument,
    type WorkflowDocument,
    type WorkflowDocumentParseFailure,
} from '@sigil/contracts';
import type { NodeIdentity, NodeOutputPort, NodeRole } from '@sigil/contracts/node-contract';

import {
    formatTopologyDiagnostics,
    type TopologyDiagnostic,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from './topology.js';

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
