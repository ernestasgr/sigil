import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import { parsePipeline } from '@sigil/schema';
import { isPluginNode } from '@sigil/schema/nodes';
import { Either, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicFileWriter, AtomicWriteFailure } from './atomic-file.js';
import {
    createWorkflowStore,
    isWorkflowIdentityError,
    isWorkflowPersistenceError,
    type WorkflowStore,
} from './workflow-store.js';
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

    it('returns a typed failure without reporting a created Workflow after a write failure', () => {
        const writeFailure: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: join(dir, 'wf-1.json'),
            message: 'disk full',
        };
        const writer: AtomicFileWriter = {
            write: vi.fn(() => Either.left(writeFailure)),
        };
        const failingStore = createWorkflowStore(dir, {}, { fileWriter: writer });

        let error: unknown;
        try {
            failingStore.create('My Workflow', samplePipeline, samplePositions);
        } catch (caught) {
            error = caught;
        }

        expect(isWorkflowPersistenceError(error)).toBe(true);
        if (isWorkflowPersistenceError(error)) {
            expect(error.operation).toBe('create');
            expect(error.workflowId).toBe('wf-1');
            expect(error.diagnostic.phase).toBe('write');
        }
        expect(failingStore.list()).toEqual([]);
        expect(writer.write).toHaveBeenCalledOnce();
    });

    it('keeps the previous Workflow visible when replacement fails during save', () => {
        const summary = store.create('Original', samplePipeline, samplePositions);
        const replacementFailure: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: join(dir, `${summary.id}.json`),
            message: 'replacement denied',
        };
        const writer: AtomicFileWriter = {
            write: vi.fn(() => Either.left(replacementFailure)),
        };
        const failingStore = createWorkflowStore(dir, {}, { fileWriter: writer });

        let error: unknown;
        try {
            failingStore.save(summary.id, 'Updated', samplePipeline, {});
        } catch (caught) {
            error = caught;
        }

        expect(isWorkflowPersistenceError(error)).toBe(true);
        expect(failingStore.getSummary(summary.id)).toMatchObject(
            Option.some({ id: summary.id, name: 'Original' }),
        );
        expect(JSON.parse(readFileSync(join(dir, `${summary.id}.json`), 'utf8')).name).toBe(
            'Original',
        );
    });

    it('uses pipeline.workflowId as the authoritative Workflow id', () => {
        const a = store.create('A', samplePipeline, {});
        expect(a.id).toBe(samplePipeline.workflowId);

        let error: unknown;
        try {
            store.create('B', samplePipeline, {});
        } catch (caught) {
            error = caught;
        }
        expect(isWorkflowIdentityError(error)).toBe(true);
        if (isWorkflowIdentityError(error)) {
            expect(error.kind).toBe('duplicate_workflow_id');
        }
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

    it('preserves Switch case identities when a persisted match value is edited and saved', () => {
        const switchPipeline: CompiledPipeline = {
            id: 'pipeline-switch',
            workflowId: 'wf-switch',
            schemaVersion: 1,
            nodes: [
                {
                    id: 'trigger',
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: { path: '/x', name: 'x', ext: 'pdf', size: 1, dir: '/x' },
                    },
                },
                {
                    id: 'switch',
                    type: 'switch',
                    config: {
                        target: 'payload',
                        field: 'ext',
                        cases: [{ id: 'case-pdf', value: 'pdf' }],
                    },
                },
                { id: 'log', type: 'log', config: { message: 'matched' } },
            ],
            edges: [
                { id: 'trigger-switch', source: 'trigger', target: 'switch', sourcePort: 'out' },
                {
                    id: 'switch-log',
                    source: 'switch',
                    target: 'log',
                    sourcePort: 'case-pdf',
                },
            ],
        };

        store.create('Switch Workflow', switchPipeline, {});
        const editedPipeline: CompiledPipeline = {
            ...switchPipeline,
            nodes: switchPipeline.nodes.map((node) =>
                !isPluginNode(node) && node.type === 'switch'
                    ? {
                          ...node,
                          config: {
                              ...node.config,
                              cases: [{ id: 'case-pdf', value: 'portable-document' }],
                          },
                      }
                    : node,
            ),
        };

        store.save('wf-switch', 'Switch Workflow', editedPipeline, {});

        const loaded = store.get('wf-switch');
        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
            const switchNode = loaded.value.pipeline.nodes.find((node) => node.id === 'switch');
            expect(switchNode).toMatchObject({
                config: {
                    cases: [{ id: 'case-pdf', value: 'portable-document' }],
                },
            });
            expect(loaded.value.pipeline.edges[1]?.sourcePort).toBe('case-pdf');
        }

        const persisted = JSON.parse(readFileSync(join(dir, 'wf-switch.json'), 'utf8'));
        expect(persisted.edges[1].sourcePort).toBe('case-pdf');
        expect(persisted.nodes[1].config.cases[0]).toEqual({
            id: 'case-pdf',
            value: 'portable-document',
        });
    });

    it('migrates legacy value-based Switch ports without dropping their connected Edge', () => {
        writeFileSync(
            join(dir, 'wf-legacy-switch.json'),
            JSON.stringify({
                id: 'wf-legacy-switch',
                name: 'Legacy Switch Workflow',
                nodes: [
                    {
                        id: 'trigger',
                        type: 'manual-trigger',
                        config: {
                            eventName: 'file.created',
                            payload: { path: '/x', name: 'x', ext: 'pdf', size: 1, dir: '/x' },
                        },
                    },
                    {
                        id: 'switch',
                        type: 'switch',
                        config: { target: 'payload', field: 'ext', cases: ['pdf'] },
                    },
                    { id: 'log', type: 'log', config: { message: 'matched' } },
                ],
                edges: [
                    {
                        id: 'trigger-switch',
                        source: 'trigger',
                        target: 'switch',
                        sourcePort: 'out',
                    },
                    { id: 'switch-log', source: 'switch', target: 'log', sourcePort: 'pdf' },
                ],
            }),
        );

        store = createWorkflowStore(dir);
        const loaded = store.get('wf-legacy-switch');
        expect(Option.isSome(loaded)).toBe(true);
        if (!Option.isSome(loaded)) return;

        expect(loaded.value.pipeline.edges[1]?.sourcePort).toBe('pdf');
        const editedPipeline: CompiledPipeline = {
            ...loaded.value.pipeline,
            nodes: loaded.value.pipeline.nodes.map((node) =>
                !isPluginNode(node) && node.type === 'switch'
                    ? {
                          ...node,
                          config: {
                              ...node.config,
                              cases: [{ id: 'pdf', value: 'portable-document' }],
                          },
                      }
                    : node,
            ),
        };

        store.save('wf-legacy-switch', 'Legacy Switch Workflow', editedPipeline, {});

        const persisted = JSON.parse(readFileSync(join(dir, 'wf-legacy-switch.json'), 'utf8'));
        expect(persisted.edges[1].sourcePort).toBe('pdf');
        expect(persisted.nodes[1].config.cases[0]).toEqual({
            id: 'pdf',
            value: 'portable-document',
        });
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

    it('rejects traversal-shaped workflow ids without touching an external file', () => {
        const externalPath = join(dir, '..', `sigil-workflow-store-${crypto.randomUUID()}.json`);
        writeFileSync(externalPath, 'sentinel');
        const escapedId = `../${basename(externalPath, '.json')}`;

        expect(() => store.save(escapedId, 'Escaped', samplePipeline, {})).toThrow();
        expect(() => store.remove(escapedId)).toThrow();

        expect(readFileSync(externalPath, 'utf-8')).toBe('sentinel');
        rmSync(externalPath, { force: true });
    });

    it.each([
        '',
        '../outside',
        '..\\outside',
        '/tmp/outside',
        'C:\\tmp\\outside',
    ])('rejects unsafe Workflow ids at the persistence seam: %s', (id) => {
        expect(() => store.get(id)).toThrow();
        expect(() => store.getSummary(id)).toThrow();
        expect(() => store.remove(id)).toThrow();
    });

    it('rejects an unsafe Pipeline workflowId when creating a Workflow', () => {
        const unsafePipeline = { ...samplePipeline, workflowId: '../outside' };

        expect(() => store.create('Unsafe Workflow', unsafePipeline, {})).toThrow();
        expect(store.list()).toEqual([]);
    });

    it('persists and retrieves a valid identifier without changing it', () => {
        const pipeline = { ...samplePipeline, workflowId: 'safe_workflow-123' };
        const summary = store.create('Safe Workflow', pipeline, {});

        expect(summary.id).toBe('safe_workflow-123');
        expect(existsSync(join(dir, 'safe_workflow-123.json'))).toBe(true);
        expect(Option.isSome(store.get('safe_workflow-123'))).toBe(true);
    });

    it('updates and deletes only the Workflow selected by its authoritative id', () => {
        const first = store.create('First', samplePipeline, {});
        const second = store.create('Second', samplePipeline2, {});
        const updatedPipeline = {
            ...samplePipeline,
            workflowId: first.id,
            nodes: [samplePipeline.nodes[0]],
            edges: [],
        };

        store.save(first.id, 'First Updated', updatedPipeline, {});
        expect(store.getSummary(second.id)).toMatchObject(
            Option.some({ id: second.id, name: 'Second' }),
        );

        expect(store.remove(first.id)).toBe(true);
        expect(store.getSummary(second.id)).toMatchObject(
            Option.some({ id: second.id, name: 'Second' }),
        );
        expect(existsSync(join(dir, `${second.id}.json`))).toBe(true);
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

    it('rejects an update whose Pipeline identity does not match the Workflow id', () => {
        const summary = store.create('Original', samplePipeline, samplePositions);
        const mismatchedPipeline = { ...samplePipeline, workflowId: 'another-workflow' };

        let error: unknown;
        try {
            store.save(summary.id, 'Mismatched', mismatchedPipeline, {});
        } catch (caught) {
            error = caught;
        }

        expect(isWorkflowIdentityError(error)).toBe(true);
        if (isWorkflowIdentityError(error)) {
            expect(error.kind).toBe('workflow_identity_mismatch');
        }
        expect(store.get(summary.id)).toEqual(expect.anything());
        expect(store.getSummary(summary.id)).toMatchObject(
            Option.some({ name: 'Original', id: summary.id }),
        );
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

    it('loads legacy unversioned Workflows and canonicalizes them on the next successful write', () => {
        const legacyPipeline = {
            ...samplePipeline,
            id: 'pipeline-legacy',
            workflowId: 'wf-legacy',
        };
        writeFileSync(
            join(dir, 'wf-legacy.json'),
            JSON.stringify({
                id: legacyPipeline.workflowId,
                name: 'Legacy Workflow',
                enabled: false,
                positions: samplePositions,
                pipelineId: legacyPipeline.id,
                workflowId: legacyPipeline.workflowId,
                nodes: legacyPipeline.nodes,
                edges: legacyPipeline.edges,
            }),
        );

        store = createWorkflowStore(dir);

        const loaded = store.get('wf-legacy');
        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
            expect(loaded.value.pipeline.schemaVersion).toBe(1);
        }

        expect(Option.isSome(store.setActivation('wf-legacy', { kind: 'active' }))).toBe(true);
        expect(JSON.parse(readFileSync(join(dir, 'wf-legacy.json'), 'utf8')).schemaVersion).toBe(1);
    });

    it('loads an explicit legacy schema version as the current in-memory Pipeline without rewriting on startup', () => {
        const legacyPipeline = {
            ...samplePipeline,
            id: 'pipeline-legacy-zero',
            workflowId: 'wf-legacy-zero',
        };
        writeFileSync(
            join(dir, 'wf-legacy-zero.json'),
            JSON.stringify({
                id: legacyPipeline.workflowId,
                name: 'Legacy Zero Workflow',
                schemaVersion: 0,
                pipelineId: legacyPipeline.id,
                workflowId: legacyPipeline.workflowId,
                nodes: legacyPipeline.nodes,
                edges: legacyPipeline.edges,
            }),
        );

        store = createWorkflowStore(dir);

        const loaded = store.get('wf-legacy-zero');
        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
            expect(loaded.value.pipeline.schemaVersion).toBe(1);
        }
        expect(
            JSON.parse(readFileSync(join(dir, 'wf-legacy-zero.json'), 'utf8')).schemaVersion,
        ).toBe(0);
    });

    it('keeps unsupported schema versions visible with diagnostics without hiding valid Workflows', () => {
        const supportedPipeline = {
            ...samplePipeline,
            id: 'pipeline-supported',
            workflowId: 'wf-supported',
        };
        store.create('Supported Workflow', supportedPipeline, {});

        const futurePipeline = {
            ...samplePipeline,
            id: 'pipeline-future',
            workflowId: 'wf-future',
        };
        writeFileSync(
            join(dir, 'wf-future.json'),
            JSON.stringify({
                id: futurePipeline.workflowId,
                name: 'Future Workflow',
                enabled: true,
                schemaVersion: 2,
                pipelineId: futurePipeline.id,
                workflowId: futurePipeline.workflowId,
                nodes: futurePipeline.nodes,
                edges: futurePipeline.edges,
            }),
        );

        store = createWorkflowStore(dir);

        expect(store.getSummary('wf-supported')).toMatchObject(
            Option.some({ id: 'wf-supported', name: 'Supported Workflow' }),
        );
        expect(store.get('wf-future')).toEqual(Option.none());
        expect(store.getSummary('wf-future')).toMatchObject(
            Option.some({
                id: 'wf-future',
                enabled: false,
                diagnostics: [
                    expect.objectContaining({
                        code: 'unsupported_schema_version',
                        target: { kind: 'pipeline' },
                    }),
                ],
            }),
        );
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

    it('keeps invalid JSON files visible on startup', () => {
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

    it('keeps files with invalid filename ids visible for recovery', () => {
        writeFileSync(join(dir, 'bad name.json'), '{invalid}');

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([
            expect.objectContaining({
                id: 'bad name',
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
        expect(() => store.get('bad name')).toThrow();
        expect(() => store.remove('bad name')).toThrow();
    });

    it('keeps topology-invalid stored Workflows visible with repair diagnostics', () => {
        writeFileSync(
            join(dir, 'wf-broken.json'),
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

    it('does not trust a stored identity that disagrees with its filename', () => {
        writeFileSync(
            join(dir, 'wf-file.json'),
            JSON.stringify({
                id: 'wf-record',
                name: 'Mismatched',
                nodes: [],
                edges: [],
            }),
        );

        store = createWorkflowStore(dir);

        expect(store.list()).toEqual([
            expect.objectContaining({
                id: 'wf-file',
                diagnostics: [
                    expect.objectContaining({
                        code: 'invalid_pipeline',
                        message: expect.stringContaining('does not match the filename id'),
                    }),
                ],
            }),
        ]);
        expect(Option.isNone(store.get('wf-file'))).toBe(true);
        expect(Option.isNone(store.get('wf-record'))).toBe(true);
    });

    it('upserts a new workflow when save() is called with a non-existent id', () => {
        const newPipeline = { ...samplePipeline, workflowId: 'new-id' };
        const saved = store.save('new-id', 'New via save', newPipeline, samplePositions);
        expect(saved.id).toBe('new-id');
        expect(saved.name).toBe('New via save');
        expect(saved.enabled).toBe(false);

        const loaded = store.get('new-id');
        expect(Option.isSome(loaded)).toBe(true);
        expect(Option.getOrThrow(loaded).pipeline).toEqual(newPipeline);
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
