import {
    closeSync,
    existsSync,
    constants as fsConstants,
    fstatSync,
    lstatSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    unlinkSync,
} from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
    type CompiledPipeline,
    type PipelineSchemaVersion,
    PipelineSchemaVersionSchema,
    parsePipeline,
} from '@sigil/schema';
import { PipelineEdgeSchema } from '@sigil/schema/edges';
import { PipelineNodeSchema } from '@sigil/schema/nodes';
import {
    type ExecutableWorkflow,
    type TopologyDiagnostic,
    type TopologyDiagnosticCode,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';
import { WorkflowIdSchema } from '@sigil/schema/workflow-id';
import { Either, Option } from 'effect';
import { z } from 'zod';

import {
    type NodePosition,
    type WorkflowActivationState,
    WorkflowActivationStateSchema,
    type WorkflowSummary,
} from '../shared/workflow.js';
import {
    type AtomicFileWriter,
    type AtomicWriteFailure,
    type AtomicWriteResult,
    atomicFileWriter,
    createAtomicWriteFailure,
} from './atomic-file.js';
import { createWorkflowTopologyError } from './workflow-topology-error.js';

export interface StoredWorkflow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly activation: WorkflowActivationState;
    readonly positions: Readonly<Record<string, NodePosition>>;
    readonly pipelineId: string;
    readonly workflowId: string;
    readonly schemaVersion: PipelineSchemaVersion;
    readonly nodes: CompiledPipeline['nodes'];
    readonly edges: CompiledPipeline['edges'];
    readonly executable: ExecutableWorkflow;
    readonly diagnostics: readonly TopologyDiagnostic[];
}

interface ValidWorkflowRecord extends StoredWorkflow {
    readonly storagePath: string;
}

interface InvalidWorkflowRecord {
    readonly id: string;
    readonly name: string;
    readonly enabled: false;
    readonly activation: WorkflowActivationState;
    readonly diagnostics: readonly TopologyDiagnostic[];
    readonly storagePath: string;
}

type WorkflowRecord = ValidWorkflowRecord | InvalidWorkflowRecord;

export type WorkflowIdentityErrorKind =
    | 'invalid_workflow_id'
    | 'workflow_identity_mismatch'
    | 'duplicate_workflow_id';

export interface WorkflowIdentityError extends Error {
    readonly kind: WorkflowIdentityErrorKind;
    readonly workflowId?: string;
}

export type WorkflowPersistenceOperation =
    | 'create'
    | 'save'
    | 'set_enabled'
    | 'set_activation'
    | 'toggle';

export interface WorkflowPersistenceError extends Error {
    readonly kind: 'workflow_persistence';
    readonly operation: WorkflowPersistenceOperation;
    readonly workflowId: string;
    readonly diagnostic: AtomicWriteFailure;
    readonly diagnostics: readonly AtomicWriteFailure[];
}

export interface WorkflowStore {
    readonly list: () => readonly WorkflowSummary[];
    readonly get: (id: string) => Option.Option<{
        readonly pipeline: CompiledPipeline;
        readonly executable: ExecutableWorkflow;
        readonly name: string;
        readonly positions: Readonly<Record<string, NodePosition>>;
    }>;
    readonly getSummary: (id: string) => Option.Option<WorkflowSummary>;
    readonly save: (
        id: string,
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, NodePosition>>,
    ) => WorkflowSummary;
    readonly create: (
        name: string,
        pipeline: CompiledPipeline,
        positions: Readonly<Record<string, NodePosition>>,
    ) => WorkflowSummary;
    readonly remove: (id: string) => boolean;
    readonly setEnabled: (id: string, enabled: boolean) => Option.Option<WorkflowSummary>;
    readonly setActivation: (
        id: string,
        activation: WorkflowActivationState,
    ) => Option.Option<WorkflowSummary>;
    readonly toggle: (id: string) => Option.Option<WorkflowSummary>;
}

export interface WorkflowStoreOptions {
    readonly fileWriter?: AtomicFileWriter;
}

function createWorkflowIdentityError(
    kind: WorkflowIdentityErrorKind,
    message: string,
    workflowId?: string,
): WorkflowIdentityError {
    return Object.assign(new Error(message), { kind, workflowId });
}

export function isWorkflowIdentityError(value: unknown): value is WorkflowIdentityError {
    return (
        value instanceof Error &&
        isRecord(value) &&
        (value.kind === 'invalid_workflow_id' ||
            value.kind === 'workflow_identity_mismatch' ||
            value.kind === 'duplicate_workflow_id')
    );
}

function createWorkflowPersistenceError(
    operation: WorkflowPersistenceOperation,
    workflowId: string,
    diagnostic: AtomicWriteFailure,
): WorkflowPersistenceError {
    const message = `Could not ${operation.replace('_', ' ')} Workflow "${workflowId}": ${diagnostic.message}`;
    const diagnostics: readonly AtomicWriteFailure[] = [diagnostic];
    return Object.assign(new Error(message), {
        name: 'WorkflowPersistenceError',
        kind: 'workflow_persistence' as const,
        operation,
        workflowId,
        diagnostic,
        diagnostics,
    });
}

export function isWorkflowPersistenceError(value: unknown): value is WorkflowPersistenceError {
    return (
        value instanceof Error &&
        isRecord(value) &&
        value.kind === 'workflow_persistence' &&
        typeof value.operation === 'string' &&
        typeof value.workflowId === 'string' &&
        'diagnostic' in value &&
        isRecord(value.diagnostic) &&
        value.diagnostic.kind === 'persistence'
    );
}

function requireWorkflowId(id: string): string {
    const parsedId = WorkflowIdSchema.safeParse(id);
    if (!parsedId.success) {
        throw createWorkflowIdentityError(
            'invalid_workflow_id',
            `Invalid Workflow id "${id}". Workflow ids must be safe file identifiers.`,
            id,
        );
    }
    return parsedId.data;
}

function isPathContained(root: string, candidate: string): boolean {
    const relativeCandidate = relative(root, candidate);
    return (
        relativeCandidate.length === 0 ||
        (relativeCandidate !== '..' &&
            !relativeCandidate.startsWith(`..${sep}`) &&
            !isAbsolute(relativeCandidate))
    );
}

function filePath(dir: string, id: string): string {
    const safeId = requireWorkflowId(id);
    const root = resolve(dir);
    const candidate = resolve(root, `${safeId}.json`);
    if (!isPathContained(root, candidate)) {
        throw createWorkflowIdentityError(
            'invalid_workflow_id',
            `Workflow path escapes its storage directory: ${id}`,
            id,
        );
    }

    if (existsSync(candidate)) {
        const rootRealPath = existsSync(root) ? realpathSync(root) : root;
        const candidateStat = lstatSync(candidate);
        if (candidateStat.isSymbolicLink()) {
            throw createWorkflowIdentityError(
                'invalid_workflow_id',
                `Workflow path is a symbolic link outside its storage directory: ${id}`,
                id,
            );
        }
        if (!isPathContained(rootRealPath, realpathSync(candidate))) {
            throw createWorkflowIdentityError(
                'invalid_workflow_id',
                `Workflow path resolves outside its storage directory: ${id}`,
                id,
            );
        }
    }
    return candidate;
}

const NodePositionSchema = z.object({ x: z.number(), y: z.number() }).readonly();
const CURRENT_WORKFLOW_SCHEMA_VERSION = PipelineSchemaVersionSchema.value;
const LEGACY_WORKFLOW_SCHEMA_VERSION = 0;

const StoredWorkflowFileSchema = z.object({
    id: WorkflowIdSchema,
    name: z.string(),
    enabled: z.boolean().optional(),
    schemaVersion: z.number().int().optional(),
    positions: z.record(z.string(), z.unknown()).optional(),
    pipelineId: z.string().min(1).optional(),
    workflowId: WorkflowIdSchema.optional(),
    nodes: z.array(PipelineNodeSchema).optional(),
    edges: z.array(PipelineEdgeSchema).optional(),
    activation: WorkflowActivationStateSchema.optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string | undefined {
    if (!isRecord(value)) return undefined;
    const candidate = value[field];
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}

function workflowIdentity(
    workflowId: string,
    raw: unknown,
): { readonly id: string; readonly name: string; readonly enabled: boolean } {
    return {
        id: workflowId,
        name: stringField(raw, 'name') ?? `Unreadable Workflow (${workflowId})`,
        enabled: isRecord(raw) && raw.enabled === true,
    };
}

function storedWorkflowDiagnostic(
    fileName: string,
    detail: string,
    code: TopologyDiagnosticCode = 'invalid_pipeline',
): TopologyDiagnostic {
    return {
        severity: 'error',
        code,
        target: { kind: 'pipeline' },
        message: `Stored Workflow file "${fileName}" is malformed: ${detail} Repair or remove the file before enabling it.`,
    };
}

function migrateSchemaVersion(
    fileName: string,
    schemaVersion: number | undefined,
):
    | { readonly ok: true; readonly value: PipelineSchemaVersion }
    | { readonly ok: false; readonly diagnostic: TopologyDiagnostic } {
    if (
        schemaVersion === undefined ||
        schemaVersion === LEGACY_WORKFLOW_SCHEMA_VERSION ||
        schemaVersion === CURRENT_WORKFLOW_SCHEMA_VERSION
    ) {
        return { ok: true, value: CURRENT_WORKFLOW_SCHEMA_VERSION };
    }

    return {
        ok: false,
        diagnostic: storedWorkflowDiagnostic(
            fileName,
            `it uses unsupported schema version ${schemaVersion}. Supported versions are the legacy version ${LEGACY_WORKFLOW_SCHEMA_VERSION} and current version ${CURRENT_WORKFLOW_SCHEMA_VERSION}; leave the file unchanged for recovery.`,
            'unsupported_schema_version',
        ),
    };
}

function invalidWorkflowRecord(
    storagePath: string,
    workflowId: string,
    raw: unknown,
    diagnostics: readonly TopologyDiagnostic[],
): InvalidWorkflowRecord {
    const identity = workflowIdentity(workflowId, raw);
    return {
        ...identity,
        enabled: false,
        activation: { kind: 'disabled' },
        diagnostics,
        storagePath,
    };
}

function initialActivationState(
    enabled: boolean,
    persisted: WorkflowActivationState | undefined,
): WorkflowActivationState {
    if (!enabled) return { kind: 'disabled' };
    if (persisted?.kind === 'failed') return persisted;
    return { kind: 'activating' };
}

function readPositions(
    rawPositions: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, NodePosition>> {
    if (!rawPositions) return {};
    const positions: Record<string, NodePosition> = {};
    for (const [key, value] of Object.entries(rawPositions)) {
        const parsed = NodePositionSchema.safeParse(value);
        if (parsed.success) {
            positions[key] = parsed.data;
        }
    }
    return positions;
}

function readWorkflowFile(
    storagePath: string,
    workflowId: string,
    topologyOptions: WorkflowTopologyOptions,
): WorkflowRecord {
    const fileName = basename(storagePath);
    let raw: unknown;
    try {
        const initialStat = lstatSync(storagePath);
        if (initialStat.isSymbolicLink()) {
            throw new Error(`Workflow file is a symbolic link: ${storagePath}`);
        }
        const initialRealPath = realpathSync(storagePath);
        const fileDescriptor = openSync(
            storagePath,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
        );
        try {
            const openedStat = fstatSync(fileDescriptor);
            const sameFileIdentity =
                process.platform === 'win32'
                    ? openedStat.ino === initialStat.ino
                    : openedStat.dev === initialStat.dev && openedStat.ino === initialStat.ino;
            if (!sameFileIdentity || realpathSync(storagePath) !== initialRealPath) {
                throw new Error(`Workflow file changed while opening: ${storagePath}`);
            }
            raw = JSON.parse(readFileSync(fileDescriptor, 'utf-8'));
        } finally {
            closeSync(fileDescriptor);
        }
    } catch {
        return invalidWorkflowRecord(storagePath, workflowId, raw, [
            storedWorkflowDiagnostic(fileName, 'it is not valid JSON.'),
        ]);
    }

    const parsedFile = StoredWorkflowFileSchema.safeParse(raw);
    if (!parsedFile.success) {
        const detail = parsedFile.error.issues[0]?.message ?? 'its shape is not a Workflow.';
        return invalidWorkflowRecord(storagePath, workflowId, raw, [
            storedWorkflowDiagnostic(fileName, detail),
        ]);
    }

    const schemaVersion = migrateSchemaVersion(fileName, parsedFile.data.schemaVersion);
    if (!schemaVersion.ok) {
        return invalidWorkflowRecord(storagePath, workflowId, raw, [schemaVersion.diagnostic]);
    }

    if (parsedFile.data.id !== workflowId) {
        return invalidWorkflowRecord(storagePath, workflowId, raw, [
            storedWorkflowDiagnostic(
                fileName,
                `its Workflow id "${parsedFile.data.id}" does not match the filename id "${workflowId}".`,
            ),
        ]);
    }

    const persistedWorkflowId = parsedFile.data.workflowId ?? parsedFile.data.id;
    if (persistedWorkflowId !== workflowId) {
        return invalidWorkflowRecord(storagePath, workflowId, raw, [
            storedWorkflowDiagnostic(
                fileName,
                `its Pipeline workflowId "${persistedWorkflowId}" does not match the Workflow id "${workflowId}".`,
            ),
        ]);
    }

    const pipeline = {
        id: parsedFile.data.pipelineId ?? parsedFile.data.id,
        workflowId: persistedWorkflowId,
        schemaVersion: schemaVersion.value,
        nodes: parsedFile.data.nodes ?? [],
        edges: parsedFile.data.edges ?? [],
    };
    const parseResult = parsePipeline(pipeline);
    if (!parseResult.ok) {
        return invalidWorkflowRecord(storagePath, workflowId, raw, [
            storedWorkflowDiagnostic(fileName, parseResult.error),
        ]);
    }

    const topology = validateWorkflowTopology(parseResult.value, topologyOptions);
    if (!topology.ok) {
        return invalidWorkflowRecord(storagePath, workflowId, raw, topology.diagnostics);
    }

    return {
        id: workflowId,
        name: parsedFile.data.name,
        enabled: parsedFile.data.enabled ?? false,
        positions: readPositions(parsedFile.data.positions),
        pipelineId: pipeline.id,
        workflowId: pipeline.workflowId,
        schemaVersion: pipeline.schemaVersion,
        nodes: pipeline.nodes,
        edges: pipeline.edges,
        activation: initialActivationState(
            parsedFile.data.enabled ?? false,
            parsedFile.data.activation,
        ),
        executable: topology.value,
        diagnostics: [],
        storagePath,
    };
}

function writeWorkflowFile(
    dir: string,
    stored: StoredWorkflow,
    writer: AtomicFileWriter,
): AtomicWriteResult {
    const data = {
        id: stored.id,
        name: stored.name,
        enabled: stored.enabled,
        positions: stored.positions,
        pipelineId: stored.pipelineId,
        workflowId: stored.workflowId,
        schemaVersion: stored.schemaVersion,
        nodes: stored.nodes,
        edges: stored.edges,
        activation: stored.activation,
    };
    const storagePath = filePath(dir, stored.id);
    let contents: string;
    try {
        contents = JSON.stringify(data, null, 2);
    } catch (error) {
        return Either.left(createAtomicWriteFailure(storagePath, 'serialize', error));
    }
    return writer.write(storagePath, contents, { createDirectory: true });
}

function writeWorkflowOrThrow(
    operation: WorkflowPersistenceOperation,
    dir: string,
    stored: StoredWorkflow,
    writer: AtomicFileWriter,
): void {
    const writeResult = writeWorkflowFile(dir, stored, writer);
    if (Either.isLeft(writeResult)) {
        throw createWorkflowPersistenceError(operation, stored.id, writeResult.left);
    }
}

function isValidWorkflowRecord(record: WorkflowRecord): record is ValidWorkflowRecord {
    return 'executable' in record;
}

function toSummary(stored: WorkflowRecord): WorkflowSummary {
    const summary = {
        id: stored.id,
        name: stored.name,
        enabled: stored.enabled,
        activation: stored.activation,
    };
    return stored.diagnostics.length > 0
        ? { ...summary, diagnostics: stored.diagnostics }
        : summary;
}

function loadAll(
    dir: string,
    topologyOptions: WorkflowTopologyOptions,
): Map<string, WorkflowRecord> {
    const workflows = new Map<string, WorkflowRecord>();
    if (!existsSync(dir)) return workflows;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const workflowId = basename(entry.name, '.json');
        const storagePath = WorkflowIdSchema.safeParse(workflowId).success
            ? filePath(dir, workflowId)
            : resolve(dir, entry.name);
        const stored = readWorkflowFile(storagePath, workflowId, topologyOptions);
        workflows.set(stored.id, stored);
    }
    return workflows;
}

export function createWorkflowStore(
    storageDir: string,
    topologyOptions: WorkflowTopologyOptions = {},
    options: WorkflowStoreOptions = {},
): WorkflowStore {
    const workflows = loadAll(storageDir, topologyOptions);
    const writer = options.fileWriter ?? atomicFileWriter;

    return {
        list: () => Array.from(workflows.values()).map(toSummary),

        getSummary: (id) => {
            const workflowId = requireWorkflowId(id);
            const stored = workflows.get(workflowId);
            return stored ? Option.some(toSummary(stored)) : Option.none();
        },

        get: (id) => {
            const workflowId = requireWorkflowId(id);
            const stored = workflows.get(workflowId);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            return Option.some({
                pipeline: stored.executable.pipeline,
                executable: stored.executable,
                name: stored.name,
                positions: stored.positions,
            });
        },

        create: (name, pipeline, positions) => {
            const workflowId = requireWorkflowId(pipeline.workflowId);
            const storagePath = filePath(storageDir, workflowId);
            if (workflows.has(workflowId) || existsSync(storagePath)) {
                throw createWorkflowIdentityError(
                    'duplicate_workflow_id',
                    `Workflow already exists: ${workflowId}`,
                    workflowId,
                );
            }
            const topology = validateWorkflowTopology(pipeline, topologyOptions);
            if (!topology.ok) {
                throw createWorkflowTopologyError(topology.diagnostics);
            }
            const stored: ValidWorkflowRecord = {
                id: workflowId,
                name,
                enabled: false,
                positions,
                pipelineId: pipeline.id,
                workflowId: pipeline.workflowId,
                schemaVersion: pipeline.schemaVersion,
                nodes: pipeline.nodes,
                edges: pipeline.edges,
                activation: { kind: 'disabled' },
                executable: topology.value,
                diagnostics: [],
                storagePath,
            };
            writeWorkflowOrThrow('create', storageDir, stored, writer);
            workflows.set(stored.id, stored);
            return toSummary(stored);
        },

        save: (id, name, pipeline, positions) => {
            const workflowId = requireWorkflowId(id);
            const storagePath = filePath(storageDir, workflowId);
            if (pipeline.workflowId !== workflowId) {
                throw createWorkflowIdentityError(
                    'workflow_identity_mismatch',
                    `Pipeline workflowId "${pipeline.workflowId}" does not match Workflow id "${workflowId}".`,
                    workflowId,
                );
            }
            const topology = validateWorkflowTopology(pipeline, topologyOptions);
            if (!topology.ok) {
                throw createWorkflowTopologyError(topology.diagnostics);
            }
            const existing = workflows.get(workflowId);
            const existingValid =
                existing && isValidWorkflowRecord(existing) ? existing : undefined;
            const stored: ValidWorkflowRecord = existingValid
                ? {
                      ...existingValid,
                      id: workflowId,
                      name,
                      positions,
                      pipelineId: pipeline.id,
                      workflowId: pipeline.workflowId,
                      schemaVersion: pipeline.schemaVersion,
                      nodes: pipeline.nodes,
                      edges: pipeline.edges,
                      activation: existingValid.activation,
                      executable: topology.value,
                      diagnostics: [],
                      storagePath,
                  }
                : {
                      id: workflowId,
                      name,
                      enabled: false,
                      positions,
                      pipelineId: pipeline.id,
                      workflowId: pipeline.workflowId,
                      schemaVersion: pipeline.schemaVersion,
                      nodes: pipeline.nodes,
                      edges: pipeline.edges,
                      activation: { kind: 'disabled' },
                      executable: topology.value,
                      diagnostics: [],
                      storagePath,
                  };
            writeWorkflowOrThrow('save', storageDir, stored, writer);
            workflows.set(workflowId, stored);
            return toSummary(stored);
        },

        remove: (id) => {
            const workflowId = requireWorkflowId(id);
            const storagePath = filePath(storageDir, workflowId);
            const stored = workflows.get(workflowId);
            if (!stored) return false;
            if (existsSync(storagePath)) {
                unlinkSync(storagePath);
            }
            workflows.delete(workflowId);
            return true;
        },

        setEnabled: (id, enabled) => {
            const workflowId = requireWorkflowId(id);
            const stored = workflows.get(workflowId);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const updated: ValidWorkflowRecord = {
                ...stored,
                enabled,
                activation: enabled ? stored.activation : { kind: 'disabled' },
            };
            writeWorkflowOrThrow('set_enabled', storageDir, updated, writer);
            workflows.set(workflowId, updated);
            return Option.some(toSummary(updated));
        },
        setActivation: (id, activation) => {
            const workflowId = requireWorkflowId(id);
            const stored = workflows.get(workflowId);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const updated: ValidWorkflowRecord = { ...stored, activation };
            writeWorkflowOrThrow('set_activation', storageDir, updated, writer);
            workflows.set(workflowId, updated);
            return Option.some(toSummary(updated));
        },
        toggle: (id) => {
            const workflowId = requireWorkflowId(id);
            const stored = workflows.get(workflowId);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const enabled = !stored.enabled;
            const updated: ValidWorkflowRecord = {
                ...stored,
                enabled,
                activation: enabled ? stored.activation : { kind: 'disabled' },
            };
            writeWorkflowOrThrow('toggle', storageDir, updated, writer);
            workflows.set(workflowId, updated);
            return Option.some(toSummary(updated));
        },
    };
}
