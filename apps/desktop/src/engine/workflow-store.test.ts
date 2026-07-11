import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { parsePipeline } from '@sigil/schema';
import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkflowStore, type WorkflowStore } from './workflow-store.js';
import { isWorkflowTopologyError } from './workflow-topology-error.js';

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

const samplePositions: Record<string, { x: number; y: number }> = {
    'node-1': { x: 100, y: 200 },
    'node-2': { x: 400, y: 200 },
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
        const summary = store.create('My Workflow', samplePipeline, samplePositions);

        expect(typeof summary.id).toBe('string');
        expect(summary.name).toBe('My Workflow');
        expect(summary.enabled).toBe(false);
    });

    it('rejects an invalid topology before saving it', () => {
        const invalidPipeline: CompiledPipeline = {
            ...samplePipeline,
            nodes: [],
            edges: [],
        };

        let error: unknown;
        try {
            store.create('Invalid Workflow', invalidPipeline, {});
        } catch (caught) {
            error = caught;
        }

        expect(isWorkflowTopologyError(error)).toBe(true);
        if (isWorkflowTopologyError(error)) {
            expect(error.diagnostics).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'empty_pipeline' })]),
            );
        }
        expect(store.list()).toEqual([]);
    });

    it('rejects a stored Pipeline whose Node handler is unavailable', () => {
        const unsupportedPipeline: CompiledPipeline = {
            ...samplePipeline,
            nodes: [
                ...samplePipeline.nodes,
                {
                    id: 'missing',
                    type: 'missing-node',
                    pluginId: 'com.example.missing',
                    config: {},
                },
            ],
            edges: [
                ...samplePipeline.edges,
                { id: 'log-missing', source: 'node-2', target: 'missing', sourcePort: 'out' },
            ],
        };
        const handlerAwareStore = createWorkflowStore(dir, {
            isNodeSupported: (node) => node.type !== 'missing-node',
        });

        expect(() =>
            handlerAwareStore.create('Unsupported Workflow', unsupportedPipeline, {}),
        ).toThrow(
            expect.objectContaining({
                kind: 'workflow_topology',
                diagnostics: expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unsupported_node_handler',
                        nodeId: 'missing',
                    }),
                ]),
            }),
        );
        expect(handlerAwareStore.list()).toEqual([]);
    });

    it('persists a created workflow as a JSON file', () => {
        const summary = store.create('My Workflow', samplePipeline, samplePositions);

        const filePath = join(dir, `${summary.id}.json`);
        expect(existsSync(filePath)).toBe(true);

        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(raw.id).toBe(summary.id);
        expect(raw.name).toBe('My Workflow');
        expect(raw.enabled).toBe(false);
        expect(raw.positions).toEqual(samplePositions);
        expect(raw.workflowId).toBe('wf-1');
        expect(raw.nodes).toHaveLength(2);
    });

    it('gives each create a unique id even when pipeline.workflowId is the same', () => {
        const a = store.create('A', samplePipeline, {});
        const b = store.create('B', samplePipeline, {});
        expect(a.id).not.toBe(b.id);
    });

    it('lists created workflows', () => {
        const a = store.create('Workflow A', samplePipeline, samplePositions);
        const b = store.create('Workflow B', samplePipeline2, {});

        const list = store.list();
        expect(list).toHaveLength(2);
        expect(list.find((w) => w.id === a.id)).toEqual({
            id: a.id,
            name: 'Workflow A',
            enabled: false,
            activation: { kind: 'disabled' },
        });
        expect(list.find((w) => w.id === b.id)).toEqual({
            id: b.id,
            name: 'Workflow B',
            enabled: false,
            activation: { kind: 'disabled' },
        });
    });

    it('returns the full pipeline and positions via get()', () => {
        const summary = store.create('My Workflow', samplePipeline, samplePositions);

        const result = store.get(summary.id);
        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result).name).toBe('My Workflow');
        expect(Option.getOrThrow(result).pipeline).toEqual(samplePipeline);
        expect(Option.getOrThrow(result).positions).toEqual(samplePositions);
    });

    it('returns None for get() on a non-existent workflow', () => {
        const result = store.get('nonexistent');
        expect(Option.isNone(result)).toBe(true);
    });

    it('deletes a workflow file', () => {
        const summary = store.create('My Workflow', samplePipeline, samplePositions);
        expect(store.list()).toHaveLength(1);

        const removed = store.remove(summary.id);
        expect(removed).toBe(true);
        expect(existsSync(join(dir, `${summary.id}.json`))).toBe(false);
        expect(store.list()).toHaveLength(0);
    });

    it('returns false when removing a non-existent workflow', () => {
        const removed = store.remove('nonexistent');
        expect(removed).toBe(false);
    });

    it('toggles the enabled state and persists it', () => {
        const summary = store.create('My Workflow', samplePipeline, samplePositions);
        const wfBefore = store.list().find((w) => w.id === summary.id);
        expect(wfBefore?.enabled).toBe(false);

        const toggled = store.toggle(summary.id);
        expect(Option.isSome(toggled)).toBe(true);
        expect(Option.getOrThrow(toggled).enabled).toBe(true);

        const wfAfter = store.list().find((w) => w.id === summary.id);
        expect(wfAfter?.enabled).toBe(true);

        const raw = JSON.parse(readFileSync(join(dir, `${summary.id}.json`), 'utf-8'));
        expect(raw.enabled).toBe(true);
    });

    it('returns None when toggling a non-existent workflow', () => {
        const toggled = store.toggle('nonexistent');
        expect(Option.isNone(toggled)).toBe(true);
    });

    it('saves an updated pipeline via save()', () => {
        const summary = store.create('Original', samplePipeline, samplePositions);

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
        const updatedPositions: Record<string, { x: number; y: number }> = {
            'node-1': { x: 50, y: 100 },
            'node-2': { x: 300, y: 100 },
        };
        const saved = store.save(summary.id, 'Updated', updatedPipeline, updatedPositions);

        expect(saved.name).toBe('Updated');
        expect(saved.enabled).toBe(false);
        expect(saved.id).toBe(summary.id);

        const loaded = store.get(summary.id);
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).pipeline.nodes).toHaveLength(2);
        expect(Option.getOrThrow(loaded).pipeline.nodes[1].type).toBe('delay');
        expect(Option.getOrThrow(loaded).positions).toEqual(updatedPositions);
    });

    it('reads pre-existing topology-valid JSON files on startup', () => {
        const fileData = {
            id: 'wf-pre',
            name: 'Pre-existing',
            enabled: true,
            positions: { 'node-a': { x: 10, y: 20 } },
            pipelineId: 'pipeline-pre',
            workflowId: 'wf-pre',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'trigger',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/x', name: 'x', ext: 'x', size: 1, dir: '/x' },
                    },
                },
            ],
            edges: [] as readonly unknown[],
        };
        writeFileSync(join(dir, 'wf-pre.json'), JSON.stringify(fileData, null, 2));

        store = createWorkflowStore(dir);

        const list = store.list();
        expect(list).toHaveLength(1);
        expect(list[0]).toEqual({
            id: 'wf-pre',
            name: 'Pre-existing',
            enabled: true,
            activation: { kind: 'activating' },
        });

        const loaded = store.get('wf-pre');
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).positions).toEqual({ 'node-a': { x: 10, y: 20 } });
        expect(parsePipeline(Option.getOrThrow(loaded).pipeline).ok).toBe(true);
    });

    it('keeps valid positions while ignoring malformed position entries', () => {
        const fileData = {
            id: 'wf-positions',
            name: 'Positions',
            positions: {
                valid: { x: 10, y: 20 },
                malformed: { x: '10', y: 20 },
            },
            nodes: [
                {
                    id: 'trigger',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/x', name: 'x', ext: 'x', size: 1, dir: '/x' },
                    },
                },
            ],
            edges: [],
        };
        writeFileSync(join(dir, 'wf-positions.json'), JSON.stringify(fileData));

        store = createWorkflowStore(dir);

        const loaded = store.get('wf-positions');
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).positions).toEqual({ valid: { x: 10, y: 20 } });
    });

    it('skips invalid JSON files on startup', () => {
        writeFileSync(join(dir, 'bad.json'), '{invalid}');

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([
            expect.objectContaining({
                id: 'bad',
                enabled: false,
                diagnostics: [
                    expect.objectContaining({
                        severity: 'error',
                        code: 'invalid_pipeline',
                        target: { kind: 'pipeline' },
                    }),
                ],
            }),
        ]);
        expect(Option.isNone(store.get('bad'))).toBe(true);
        expect(store.remove('bad')).toBe(true);
    });

    it('keeps topology-invalid stored Workflows visible with repair diagnostics', () => {
        writeFileSync(
            join(dir, 'broken.json'),
            JSON.stringify({ id: 'wf-broken', name: 'Broken', nodes: [], edges: [] }),
        );

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([
            expect.objectContaining({
                id: 'wf-broken',
                name: 'Broken',
                enabled: false,
                diagnostics: [
                    expect.objectContaining({
                        severity: 'error',
                        code: 'empty_pipeline',
                        target: { kind: 'pipeline' },
                    }),
                ],
            }),
        ]);
        expect(Option.isNone(store.get('wf-broken'))).toBe(true);
    });

    it('keeps stored files with an invalid shape visible for recovery', () => {
        writeFileSync(join(dir, 'bad-shape.json'), JSON.stringify({ foo: 'bar' }));

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([
            expect.objectContaining({
                id: 'bad-shape',
                name: 'Unreadable Workflow (bad-shape)',
                diagnostics: [
                    expect.objectContaining({
                        severity: 'error',
                        code: 'invalid_pipeline',
                        target: { kind: 'pipeline' },
                    }),
                ],
            }),
        ]);
    });

    it('upserts a new workflow when save() is called with a non-existent id', () => {
        const saved = store.save('new-id', 'New via save', samplePipeline, samplePositions);
        expect(saved.id).toBe('new-id');
        expect(saved.name).toBe('New via save');
        expect(saved.enabled).toBe(false);

        const loaded = store.get('new-id');
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).pipeline).toEqual(samplePipeline);
        expect(Option.getOrThrow(loaded).positions).toEqual(samplePositions);

        const filePath = join(dir, 'new-id.json');
        expect(existsSync(filePath)).toBe(true);
    });

    it('preserves positions across toggle', () => {
        const summary = store.create('My Workflow', samplePipeline, samplePositions);
        store.toggle(summary.id);

        const loaded = store.get(summary.id);
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).positions).toEqual(samplePositions);
    });
});
