import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompiledPipeline } from '@sigil/schema';
import { parsePipeline } from '@sigil/schema';

import { createWorkflowStore, type WorkflowStore } from './workflow-store.js';

function randomDir(): string {
    return join(tmpdir(), `sigil-test-workflow-store-${crypto.randomUUID()}`);
}

const samplePipeline: CompiledPipeline = {
    id: 'pipeline-1',
    workflowId: 'wf-1',
    schemaVersion: 1,
    nodes: [
        {
            id: 'node-1',
            type: 'manual-trigger',
            config: {
                eventName: 'file.created',
                payload: { path: '/x', name: 'x', ext: 'x', size: 1, dir: '/x' },
            },
        },
        {
            id: 'node-2',
            type: 'log',
            config: { message: 'hello' },
        },
    ],
    edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', sourcePort: 'out' }],
};

const samplePipeline2: CompiledPipeline = {
    id: 'pipeline-2',
    workflowId: 'wf-2',
    schemaVersion: 1,
    nodes: [
        {
            id: 'node-1',
            type: 'manual-trigger',
            config: {
                eventName: 'file.created',
                payload: { path: '/x', name: 'x', ext: 'x', size: 1, dir: '/x' },
            },
        },
    ],
    edges: [],
};

describe('WorkflowStore', () => {
    let dir: string;
    let store: WorkflowStore;

    beforeEach(() => {
        dir = randomDir();
        mkdirSync(dir, { recursive: true });
        store = createWorkflowStore(dir);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('lists no workflows when the directory is empty', () => {
        const list = store.list();
        expect(list).toEqual([]);
    });

    it('creates a workflow and returns its summary', () => {
        const summary = store.create('My Workflow', samplePipeline);

        expect(summary.id).toBe('wf-1');
        expect(summary.name).toBe('My Workflow');
        expect(summary.enabled).toBe(false);
    });

    it('persists a created workflow as a JSON file', () => {
        store.create('My Workflow', samplePipeline);

        const filePath = join(dir, 'wf-1.json');
        expect(existsSync(filePath)).toBe(true);

        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(raw.id).toBe('wf-1');
        expect(raw.name).toBe('My Workflow');
        expect(raw.enabled).toBe(false);
        expect(raw.workflowId).toBe('wf-1');
        expect(raw.nodes).toHaveLength(2);
    });

    it('lists created workflows', () => {
        store.create('Workflow A', samplePipeline);
        store.create('Workflow B', samplePipeline2);

        const list = store.list();
        expect(list).toHaveLength(2);
        expect(list.find((w) => w.id === 'wf-1')).toEqual({
            id: 'wf-1',
            name: 'Workflow A',
            enabled: false,
        });
        expect(list.find((w) => w.id === 'wf-2')).toEqual({
            id: 'wf-2',
            name: 'Workflow B',
            enabled: false,
        });
    });

    it('returns the full pipeline via get()', () => {
        store.create('My Workflow', samplePipeline);

        const result = store.get('wf-1');
        expect(result).not.toBeNull();
        expect(result?.name).toBe('My Workflow');
        expect(result?.pipeline).toEqual(samplePipeline);
    });

    it('returns null for get() on a non-existent workflow', () => {
        const result = store.get('nonexistent');
        expect(result).toBeNull();
    });

    it('deletes a workflow file', () => {
        store.create('My Workflow', samplePipeline);
        expect(store.list()).toHaveLength(1);

        const removed = store.remove('wf-1');
        expect(removed).toBe(true);
        expect(existsSync(join(dir, 'wf-1.json'))).toBe(false);
        expect(store.list()).toHaveLength(0);
    });

    it('returns false when removing a non-existent workflow', () => {
        const removed = store.remove('nonexistent');
        expect(removed).toBe(false);
    });

    it('toggles the enabled state and persists it', () => {
        store.create('My Workflow', samplePipeline);
        const wfBefore = store.list().find((w) => w.id === 'wf-1');
        expect(wfBefore?.enabled).toBe(false);

        const toggled = store.toggle('wf-1');
        expect(toggled?.enabled).toBe(true);

        const wfAfter = store.list().find((w) => w.id === 'wf-1');
        expect(wfAfter?.enabled).toBe(true);

        const raw = JSON.parse(readFileSync(join(dir, 'wf-1.json'), 'utf-8'));
        expect(raw.enabled).toBe(true);
    });

    it('returns null when toggling a non-existent workflow', () => {
        const toggled = store.toggle('nonexistent');
        expect(toggled).toBeNull();
    });

    it('saves an updated pipeline via save()', () => {
        store.create('Original', samplePipeline);

        const updatedPipeline: CompiledPipeline = {
            ...samplePipeline,
            nodes: [
                {
                    id: 'node-1',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/x', name: 'x', ext: 'x', size: 1, dir: '/x' },
                    },
                },
                { id: 'node-2', type: 'delay', config: { ms: 5000 } },
            ],
        };
        const summary = store.save('wf-1', 'Updated', updatedPipeline);

        expect(summary.name).toBe('Updated');
        expect(summary.enabled).toBe(false);

        const loaded = store.get('wf-1');
        expect(loaded?.pipeline.nodes).toHaveLength(2);
        expect(loaded?.pipeline.nodes[1].type).toBe('delay');
    });

    it('reads pre-existing JSON files on startup', () => {
        const fileData = {
            id: 'wf-pre',
            name: 'Pre-existing',
            enabled: true,
            pipelineId: 'pipeline-pre',
            workflowId: 'wf-pre',
            schemaVersion: 1,
            nodes: [] as readonly unknown[],
            edges: [] as readonly unknown[],
        };
        writeFileSync(join(dir, 'wf-pre.json'), JSON.stringify(fileData, null, 2));

        store = createWorkflowStore(dir);

        const list = store.list();
        expect(list).toHaveLength(1);
        expect(list[0]).toEqual({ id: 'wf-pre', name: 'Pre-existing', enabled: true });

        const loaded = store.get('wf-pre');
        expect(loaded).not.toBeNull();
        expect(loaded && parsePipeline(loaded.pipeline).ok).toBe(true);
    });

    it('skips invalid JSON files on startup', () => {
        writeFileSync(join(dir, 'bad.json'), '{invalid}');

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([]);
    });

    it('skips JSON files that are not valid CompiledPipelines on startup', () => {
        writeFileSync(join(dir, 'bad.json'), JSON.stringify({ foo: 'bar' }));

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([]);
    });
});
