import { randomUUID } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
} from '@sigil/schema/topology';
import { Option } from 'effect';
import { z } from 'zod';

import type { NodePosition, WorkflowSummary } from '../shared/workflow.js';
import { createWorkflowTopologyError } from './workflow-topology-error.js';

export interface StoredWorkflow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly positions: Readonly<Record<string, NodePosition>>;
    readonly pipelineId: string;
    readonly workflowId: string;
    readonly schemaVersion: PipelineSchemaVersion;
    readonly nodes: CompiledPipeline['nodes'];
    readonly edges: CompiledPipeline['edges'];
    readonly executable: ExecutableWorkflow;
}

export interface WorkflowStore {
    readonly list: () => readonly WorkflowSummary[];
    readonly get: (id: string) => Option.Option<{
        readonly pipeline: CompiledPipeline;
        readonly executable: ExecutableWorkflow;
        readonly name: string;
        readonly positions: Readonly<Record<string, NodePosition>>;
    }>;
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
});

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
    filePath: string,
    topologyOptions: WorkflowTopologyOptions,
): Option.Option<StoredWorkflow> {
    try {
        const parsedFile = StoredWorkflowFileSchema.safeParse(
            JSON.parse(readFileSync(filePath, 'utf-8')),
        );
        if (!parsedFile.success) return Option.none();

        const pipeline = {
            id: parsedFile.data.pipelineId ?? parsedFile.data.id,
            workflowId: parsedFile.data.workflowId ?? parsedFile.data.id,
            schemaVersion: PipelineSchemaVersionSchema.value,
            nodes: parsedFile.data.nodes ?? [],
            edges: parsedFile.data.edges ?? [],
        };
        const parseResult = parsePipeline(pipeline);
        if (!parseResult.ok) return Option.none();
        const topology = validateWorkflowTopology(parseResult.value, topologyOptions);
        if (!topology.ok) return Option.none();
        return Option.some({
            id: parsedFile.data.id,
            name: parsedFile.data.name,
            enabled: parsedFile.data.enabled ?? false,
            positions: readPositions(parsedFile.data.positions),
            pipelineId: pipeline.id,
            workflowId: pipeline.workflowId,
            schemaVersion: pipeline.schemaVersion,
            nodes: pipeline.nodes,
            edges: pipeline.edges,
            executable: topology.value,
        });
    } catch {
        return Option.none();
    }
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
    };
    writeFileSync(filePath(dir, stored.id), JSON.stringify(data, null, 2), 'utf-8');
}

function toSummary(stored: StoredWorkflow): WorkflowSummary {
    return { id: stored.id, name: stored.name, enabled: stored.enabled };
}

function loadAll(
    dir: string,
    topologyOptions: WorkflowTopologyOptions,
): Map<string, StoredWorkflow> {
    const workflows = new Map<string, StoredWorkflow>();
    if (!existsSync(dir)) return workflows;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const stored = readWorkflowFile(join(dir, entry.name), topologyOptions);
        if (Option.isSome(stored)) {
            workflows.set(stored.value.id, stored.value);
        }
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

        get: (id) => {
            const stored = workflows.get(id);
            if (!stored) return Option.none();
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
            const stored: StoredWorkflow = {
                id: randomUUID(),
                name,
                enabled: false,
                positions,
                pipelineId: pipeline.id,
                workflowId: pipeline.workflowId,
                schemaVersion: pipeline.schemaVersion,
                nodes: pipeline.nodes,
                edges: pipeline.edges,
                executable: topology.value,
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
            const stored: StoredWorkflow = existing
                ? {
                      ...existing,
                      name,
                      positions,
                      pipelineId: pipeline.id,
                      workflowId: pipeline.workflowId,
                      schemaVersion: pipeline.schemaVersion,
                      nodes: pipeline.nodes,
                      edges: pipeline.edges,
                      executable: topology.value,
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
                      executable: topology.value,
                  };
            workflows.set(id, stored);
            writeWorkflowFile(storageDir, stored);
            return toSummary(stored);
        },

        remove: (id) => {
            if (!workflows.has(id)) return false;
            workflows.delete(id);
            const path = filePath(storageDir, id);
            if (existsSync(path)) {
                unlinkSync(path);
            }
            return true;
        },

        setEnabled: (id, enabled) => {
            const stored = workflows.get(id);
            if (!stored) return Option.none();
            const updated: StoredWorkflow = { ...stored, enabled };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return Option.some(toSummary(updated));
        },
        toggle: (id) => {
            const stored = workflows.get(id);
            if (!stored) return Option.none();
            const updated: StoredWorkflow = { ...stored, enabled: !stored.enabled };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return Option.some(toSummary(updated));
        },
    };
}
