import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { parsePipeline, type CompiledPipeline, type PipelineSchemaVersion } from '@sigil/schema';

import type { NodePosition, WorkflowSummary } from '../shared/workflow.js';

export interface StoredWorkflow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly positions: Readonly<Record<string, NodePosition>>;
    readonly pipelineId: string;
    readonly workflowId: string;
    readonly schemaVersion: PipelineSchemaVersion;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}

export interface WorkflowStore {
    readonly list: () => readonly WorkflowSummary[];
    readonly get: (id: string) => {
        readonly pipeline: CompiledPipeline;
        readonly name: string;
        readonly positions: Readonly<Record<string, NodePosition>>;
    } | null;
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
    readonly setEnabled: (id: string, enabled: boolean) => WorkflowSummary | null;
    readonly toggle: (id: string) => WorkflowSummary | null;
}

function filePath(dir: string, id: string): string {
    return join(dir, `${id}.json`);
}

function readPositions(raw: Record<string, unknown>): Record<string, NodePosition> {
    const rawPositions = raw['positions'];
    if (!rawPositions || typeof rawPositions !== 'object') return {};
    const positions: Record<string, NodePosition> = {};
    for (const [key, value] of Object.entries(rawPositions)) {
        if (
            value &&
            typeof value === 'object' &&
            'x' in value &&
            'y' in value &&
            typeof (value as Record<string, unknown>).x === 'number' &&
            typeof (value as Record<string, unknown>).y === 'number'
        ) {
            positions[key] = value as NodePosition;
        }
    }
    return positions;
}

function readWorkflowFile(filePath: string): StoredWorkflow | null {
    try {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
        const pipeline = {
            id: typeof raw.pipelineId === 'string' ? raw.pipelineId : raw.id,
            workflowId: typeof raw.workflowId === 'string' ? raw.workflowId : raw.id,
            schemaVersion: 1 as PipelineSchemaVersion,
            nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
            edges: Array.isArray(raw.edges) ? raw.edges : [],
        };
        const parseResult = parsePipeline(pipeline);
        if (!parseResult.ok) return null;
        return {
            id: raw.id as string,
            name: raw.name as string,
            enabled: typeof raw.enabled === 'boolean' ? (raw.enabled as boolean) : false,
            positions: readPositions(raw),
            pipelineId: pipeline.id,
            workflowId: pipeline.workflowId,
            schemaVersion: pipeline.schemaVersion,
            nodes: pipeline.nodes,
            edges: pipeline.edges,
        };
    } catch {
        return null;
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

function loadAll(dir: string): Map<string, StoredWorkflow> {
    const workflows = new Map<string, StoredWorkflow>();
    if (!existsSync(dir)) return workflows;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const stored = readWorkflowFile(join(dir, entry.name));
        if (stored) {
            workflows.set(stored.id, stored);
        }
    }
    return workflows;
}

export function createWorkflowStore(storageDir: string): WorkflowStore {
    const workflows = loadAll(storageDir);

    return {
        list: () => Array.from(workflows.values()).map(toSummary),

        get: (id) => {
            const stored = workflows.get(id);
            if (!stored) return null;
            const pipeline: CompiledPipeline = {
                id: stored.pipelineId,
                workflowId: stored.workflowId,
                schemaVersion: stored.schemaVersion,
                nodes: stored.nodes as CompiledPipeline['nodes'],
                edges: stored.edges as CompiledPipeline['edges'],
            };
            return { pipeline, name: stored.name, positions: stored.positions };
        },

        create: (name, pipeline, positions) => {
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
            };
            workflows.set(stored.id, stored);
            writeWorkflowFile(storageDir, stored);
            return toSummary(stored);
        },

        save: (id, name, pipeline, positions) => {
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
            if (!stored) return null;
            const updated: StoredWorkflow = { ...stored, enabled };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return toSummary(updated);
        },
        toggle: (id) => {
            const stored = workflows.get(id);
            if (!stored) return null;
            const updated: StoredWorkflow = { ...stored, enabled: !stored.enabled };
            workflows.set(id, updated);
            writeWorkflowFile(storageDir, updated);
            return toSummary(updated);
        },
    };
}
