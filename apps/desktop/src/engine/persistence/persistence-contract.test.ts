import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync as Database } from 'node:sqlite';
import type { WorkflowDocument } from '@sigil/contracts';
import { PluginIdSchema, WorkflowIdSchema } from '@sigil/contracts/ids';
import { Effect, Either, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDocument } from '../../test-support/pipeline-fixtures.js';
import { readPropertiesFile, writePropertiesFile } from '../core/properties-loader.js';
import {
    createInMemoryWorkflowStateStore,
    createWorkflowStateStore,
    type WorkflowStateStore,
} from '../workflow/workflow-state.js';
import { createWorkflowStore } from '../workflow/workflow-store.js';
import type { AtomicFileWriter } from './atomic-file.js';
import { createPermissionOverrideStore } from './permission-override-store.js';

const CONTRACT_WORKFLOW_ID = WorkflowIdSchema.parse('wf-contract');
const CONTRACT_WORKFLOW_A_ID = WorkflowIdSchema.parse('wf-contract-a');
const CONTRACT_WORKFLOW_B_ID = WorkflowIdSchema.parse('wf-contract-b');

const contractDocument: WorkflowDocument = testDocument({
    id: 'pipeline-contract',
    workflowId: 'wf-contract',
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
});

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sigil-persistence-contract-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

function runWorkflowStateContract(store: WorkflowStateStore): void {
    const first = store.forWorkflow(CONTRACT_WORKFLOW_A_ID);
    first.set('empty', '');
    first.set('value', 'a-value');
    store.setKey(CONTRACT_WORKFLOW_B_ID, 'survivor', 'b-value');
    first.flush();

    expect(first.get('empty')).toEqual(Option.some(''));
    expect(store.listKeys(CONTRACT_WORKFLOW_A_ID)).toEqual(
        expect.arrayContaining([
            { key: 'empty', type: 'string', value: '' },
            { key: 'value', type: 'string', value: 'a-value' },
        ]),
    );
    expect(store.listKeys(CONTRACT_WORKFLOW_B_ID)).toEqual([
        { key: 'survivor', type: 'string', value: 'b-value' },
    ]);

    store.deleteWorkflow(CONTRACT_WORKFLOW_A_ID);

    expect(store.listKeys(CONTRACT_WORKFLOW_A_ID)).toEqual([]);
    expect(store.listKeys(CONTRACT_WORKFLOW_B_ID)).toEqual([
        { key: 'survivor', type: 'string', value: 'b-value' },
    ]);
}

describe('Persistence restart contract', () => {
    it('restores Workflow intent and content through a fresh filesystem-backed store', () => {
        const workflowDir = join(tempDir, 'workflows');
        const first = createWorkflowStore(workflowDir);
        const created = first.create('Contract Workflow', contractDocument, {
            trigger: { x: 10, y: 20 },
        });
        first.toggle(created.id);

        const restarted = createWorkflowStore(workflowDir);

        expect(restarted.getSummary(created.id)).toMatchObject(
            Option.some({
                id: created.id,
                name: 'Contract Workflow',
                enabled: true,
                activation: { kind: 'activating' },
            }),
        );
        expect(restarted.get(created.id)).toMatchObject(
            Option.some({
                document: contractDocument,
                positions: { trigger: { x: 10, y: 20 } },
            }),
        );
    });

    it('keeps healthy Workflows visible beside corruption and ignores interrupted temp files', () => {
        const workflowDir = join(tempDir, 'workflows');
        const first = createWorkflowStore(workflowDir);
        const created = first.create('Healthy Workflow', contractDocument, {});
        writeFileSync(join(workflowDir, 'wf-corrupt.json'), '{not-json');
        writeFileSync(
            join(workflowDir, `.${created.id}.json.interrupted.tmp`),
            JSON.stringify({ ...contractDocument, name: 'uncommitted replacement' }),
        );

        const restarted = createWorkflowStore(workflowDir);

        expect(restarted.getSummary(created.id)).toMatchObject(
            Option.some({ id: created.id, name: 'Healthy Workflow' }),
        );
        expect(restarted.getSummary('wf-corrupt')).toMatchObject(
            Option.some({
                id: 'wf-corrupt',
                enabled: false,
                diagnostics: [
                    expect.objectContaining({
                        severity: 'error',
                        code: 'invalid_pipeline',
                    }),
                ],
            }),
        );
        expect(restarted.get('wf-corrupt')).toEqual(Option.none());
        expect(JSON.parse(readFileSync(join(workflowDir, `${created.id}.json`), 'utf8')).name).toBe(
            'Healthy Workflow',
        );
    });

    it('round-trips Properties and permission overrides through fresh adapters', () => {
        const propertiesPath = join(tempDir, 'sigil.properties.json');
        const overridesPath = join(tempDir, 'nested', 'permission-overrides.json');
        const properties = {
            notifyOnWorkflowError: false,
            databasePath: join(tempDir, 'sigil.db'),
        };

        expect(Either.isRight(writePropertiesFile(propertiesPath, properties))).toBe(true);
        const firstOverrides = createPermissionOverrideStore(overridesPath);
        expect(
            Either.isRight(
                firstOverrides.set(PluginIdSchema.parse('com.sigil.contract'), ['network']),
            ),
        ).toBe(true);

        const restartedOverrides = createPermissionOverrideStore(overridesPath);

        expect(Effect.runSync(readPropertiesFile(propertiesPath))).toEqual(properties);
        expect(restartedOverrides.get(PluginIdSchema.parse('com.sigil.contract'))).toEqual([
            'network',
        ]);
        expect(restartedOverrides.all()).toEqual({ 'com.sigil.contract': ['network'] });
    });

    it('keeps the last committed settings after an interrupted replacement', () => {
        const propertiesPath = join(tempDir, 'sigil.properties.json');
        const overridesPath = join(tempDir, 'permission-overrides.json');
        const initialProperties = { notifyOnWorkflowError: false };
        expect(Either.isRight(writePropertiesFile(propertiesPath, initialProperties))).toBe(true);
        const initialOverrides = createPermissionOverrideStore(overridesPath);
        expect(
            Either.isRight(
                initialOverrides.set(PluginIdSchema.parse('com.sigil.contract'), ['network']),
            ),
        ).toBe(true);

        const interruptedWriter: AtomicFileWriter = {
            write: (targetPath) =>
                Either.left({
                    kind: 'persistence',
                    operation: 'write',
                    phase: 'replace',
                    path: targetPath,
                    message: 'replacement interrupted',
                }),
        };

        const propertiesResult = writePropertiesFile(
            propertiesPath,
            { notifyOnWorkflowError: true },
            interruptedWriter,
        );
        const failingOverrides = createPermissionOverrideStore(overridesPath, interruptedWriter);
        const overridesResult = failingOverrides.set(PluginIdSchema.parse('com.sigil.contract'), [
            'filesystem.read',
        ]);

        expect(Either.isLeft(propertiesResult)).toBe(true);
        expect(Either.isLeft(overridesResult)).toBe(true);
        expect(Effect.runSync(readPropertiesFile(propertiesPath))).toEqual(initialProperties);
        expect(
            createPermissionOverrideStore(overridesPath).get(
                PluginIdSchema.parse('com.sigil.contract'),
            ),
        ).toEqual(['network']);
    });

    it('applies the same Workflow State contract to the in-memory adapter', () => {
        const store = createInMemoryWorkflowStateStore();

        runWorkflowStateContract(store);
        store.dispose();
    });

    it('applies the same Workflow State contract to the SQLite adapter', () => {
        const database = new Database(':memory:');
        const store = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

        try {
            runWorkflowStateContract(store);
        } finally {
            store.dispose();
            database.close();
        }
    });

    it('restores SQLite Workflow State after closing and reopening its database file', () => {
        const databasePath = join(tempDir, 'sigil.db');
        const firstDatabase = new Database(databasePath);
        const first = createWorkflowStateStore(firstDatabase, { flushIntervalMs: 60_000 });
        first.forWorkflow(CONTRACT_WORKFLOW_ID).set('last-run', '2026-07-12');
        first.forWorkflow(CONTRACT_WORKFLOW_ID).set('empty', '');
        first.dispose();
        firstDatabase.close();

        const restartedDatabase = new Database(databasePath);
        const restarted = createWorkflowStateStore(restartedDatabase, { flushIntervalMs: 60_000 });
        try {
            expect(restarted.forWorkflow(CONTRACT_WORKFLOW_ID).get('last-run')).toEqual(
                Option.some('2026-07-12'),
            );
            expect(restarted.forWorkflow(CONTRACT_WORKFLOW_ID).get('empty')).toEqual(
                Option.some(''),
            );
        } finally {
            restarted.dispose();
            restartedDatabase.close();
        }
    });
});
