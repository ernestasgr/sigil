import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { parsePipeline, type CompiledPipeline, type PipelineSchemaVersion } from '@sigil/schema';

import type { WorkflowSummary } from '../shared/workflow.js';

export interface StoredWorkflow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly pipelineId: string;
    readonly workflowId: string;
    readonly schemaVersion: PipelineSchemaVersion;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}

export interface WorkflowStore {
    readonly list: () => readonly WorkflowSummary[];
    readonly get: (
        id: string,
    ) => { readonly pipeline: CompiledPipeline; readonly name: string } | null;
    readonly save: (id: string, name: string, pipeline: CompiledPipeline) => WorkflowSummary;
    readonly create: (name: string, pipeline: CompiledPipeline) => WorkflowSummary;
    readonly remove: (id: string) => boolean;
    readonly toggle: (id: string) => WorkflowSummary | null;
}

function filePath(dir: string, id: string): string {
    return join(dir, `${id}.json`);
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
            return { pipeline, name: stored.name };
        },

        create: (name, pipeline) => {
            const stored: StoredWorkflow = {
                id: pipeline.workflowId,
                name,
                enabled: false,
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

        save: (id, name, pipeline) => {
            const existing = workflows.get(id);
            if (!existing) {
                return toSummary({
                    id,
                    name,
                    enabled: false,
                    pipelineId: pipeline.id,
                    workflowId: pipeline.workflowId,
                    schemaVersion: pipeline.schemaVersion,
                    nodes: pipeline.nodes,
                    edges: pipeline.edges,
                });
            }
            const stored: StoredWorkflow = {
                ...existing,
                name,
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
