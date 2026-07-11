import { randomUUID } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
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
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';
import { Option } from 'effect';
import { z } from 'zod';

import {
    type NodePosition,
    type WorkflowActivationState,
    WorkflowActivationStateSchema,
    type WorkflowSummary,
} from '../shared/workflow.js';
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

function filePath(dir: string, id: string): string {
    return join(dir, `${id}.json`);
}

const NodePositionSchema = z.object({ x: z.number(), y: z.number() }).readonly();

const StoredWorkflowFileSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    enabled: z.boolean().optional(),
    positions: z.record(z.string(), z.unknown()).optional(),
    pipelineId: z.string().min(1).optional(),
    workflowId: z.string().min(1).optional(),
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
    storagePath: string,
    raw: unknown,
): { readonly id: string; readonly name: string; readonly enabled: boolean } {
    const id = stringField(raw, 'id') ?? basename(storagePath, '.json');
    return {
        id,
        name: stringField(raw, 'name') ?? `Unreadable Workflow (${id})`,
        enabled: isRecord(raw) && raw.enabled === true,
    };
}

function storedWorkflowDiagnostic(fileName: string, detail: string): TopologyDiagnostic {
    return {
        severity: 'error',
        code: 'invalid_pipeline',
        target: { kind: 'pipeline' },
        message: `Stored Workflow file "${fileName}" is malformed: ${detail} Repair or remove the file before enabling it.`,
    };
}

function invalidWorkflowRecord(
    storagePath: string,
    raw: unknown,
    diagnostics: readonly TopologyDiagnostic[],
): InvalidWorkflowRecord {
    const identity = workflowIdentity(storagePath, raw);
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
    topologyOptions: WorkflowTopologyOptions,
): WorkflowRecord {
    const fileName = basename(storagePath);
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(storagePath, 'utf-8'));
    } catch {
        return invalidWorkflowRecord(storagePath, raw, [
            storedWorkflowDiagnostic(fileName, 'it is not valid JSON.'),
        ]);
    }

    const parsedFile = StoredWorkflowFileSchema.safeParse(raw);
    if (!parsedFile.success) {
        const detail = parsedFile.error.issues[0]?.message ?? 'its shape is not a Workflow.';
        return invalidWorkflowRecord(storagePath, raw, [
            storedWorkflowDiagnostic(fileName, detail),
        ]);
    }

    const pipeline = {
        id: parsedFile.data.pipelineId ?? parsedFile.data.id,
        workflowId: parsedFile.data.workflowId ?? parsedFile.data.id,
        schemaVersion: PipelineSchemaVersionSchema.value,
        nodes: parsedFile.data.nodes ?? [],
        edges: parsedFile.data.edges ?? [],
    };
    const parseResult = parsePipeline(pipeline);
    if (!parseResult.ok) {
        return invalidWorkflowRecord(storagePath, raw, [
            storedWorkflowDiagnostic(fileName, parseResult.error),
        ]);
    }

    const topology = validateWorkflowTopology(parseResult.value, topologyOptions);
    if (!topology.ok) return invalidWorkflowRecord(storagePath, raw, topology.diagnostics);

    return {
        id: parsedFile.data.id,
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

function writeWorkflowFile(dir: string, stored: StoredWorkflow): void {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
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
    writeFileSync(filePath(dir, stored.id), JSON.stringify(data, null, 2), 'utf-8');
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
        const stored = readWorkflowFile(join(dir, entry.name), topologyOptions);
        workflows.set(stored.id, stored);
    }
    return workflows;
}

export function createWorkflowStore(
    storageDir: string,
    topologyOptions: WorkflowTopologyOptions = {},
): WorkflowStore {
    const workflows = loadAll(storageDir, topologyOptions);

    return {
        list: () => Array.from(workflows.values()).map(toSummary),

        getSummary: (id) => {
            const stored = workflows.get(id);
            return stored ? Option.some(toSummary(stored)) : Option.none();
        },

        get: (id) => {
            const stored = workflows.get(id);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            return Option.some({
                pipeline: stored.executable.pipeline,
                executable: stored.executable,
                name: stored.name,
                positions: stored.positions,
            });
        },

        create: (name, pipeline, positions) => {
            const topology = validateWorkflowTopology(pipeline, topologyOptions);
            if (!topology.ok) {
                throw createWorkflowTopologyError(topology.diagnostics);
            }
            const id = randomUUID();
            const stored: ValidWorkflowRecord = {
                id,
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
                storagePath: filePath(storageDir, id),
            };
            workflows.set(stored.id, stored);
            writeWorkflowFile(storageDir, stored);
            return toSummary(stored);
        },

        save: (id, name, pipeline, positions) => {
            const topology = validateWorkflowTopology(pipeline, topologyOptions);
            if (!topology.ok) {
                throw createWorkflowTopologyError(topology.diagnostics);
            }
            const existing = workflows.get(id);
            const existingValid =
                existing && isValidWorkflowRecord(existing) ? existing : undefined;
            const stored: ValidWorkflowRecord = existingValid
                ? {
                      ...existingValid,
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
                  }
                : {
                      id,
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
                      storagePath: filePath(storageDir, id),
                  };
            workflows.set(id, stored);
            writeWorkflowFile(storageDir, stored);
            return toSummary(stored);
        },

        remove: (id) => {
            const stored = workflows.get(id);
            if (!stored) return false;
            workflows.delete(id);
            if (existsSync(stored.storagePath)) {
                unlinkSync(stored.storagePath);
            }
            return true;
        },

        setEnabled: (id, enabled) => {
            const stored = workflows.get(id);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const updated: ValidWorkflowRecord = {
                ...stored,
                enabled,
                activation: enabled ? stored.activation : { kind: 'disabled' },
            };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return Option.some(toSummary(updated));
        },
        setActivation: (id, activation) => {
            const stored = workflows.get(id);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const updated: ValidWorkflowRecord = { ...stored, activation };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return Option.some(toSummary(updated));
        },
        toggle: (id) => {
            const stored = workflows.get(id);
            if (!stored || !isValidWorkflowRecord(stored)) return Option.none();
            const enabled = !stored.enabled;
            const updated: ValidWorkflowRecord = {
                ...stored,
                enabled,
                activation: enabled ? stored.activation : { kind: 'disabled' },
            };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return Option.some(toSummary(updated));
        },
    };
}
