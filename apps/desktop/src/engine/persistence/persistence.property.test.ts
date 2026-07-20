import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Option } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    createInMemoryWorkflowStateStore,
    createWorkflowStateStore,
    type WorkflowStatePrimitive,
    type WorkflowStateStore,
} from './workflow-state.js';

const PROPERTY_OPTIONS = {
    numRuns: 60,
    seed: 118_2028,
    verbose: true,
};

const WORKFLOW_IDS = ['wf-a', 'wf-b', 'wf-c'] as const;
const KEYS = ['alpha', 'beta', 'gamma', 'empty'] as const;

type WorkflowId = (typeof WORKFLOW_IDS)[number];
type StateKey = (typeof KEYS)[number];

type StateOperation =
    | {
          readonly kind: 'set';
          readonly workflowId: WorkflowId;
          readonly key: StateKey;
          readonly value: string;
      }
    | {
          readonly kind: 'setKey';
          readonly workflowId: WorkflowId;
          readonly key: StateKey;
          readonly value: string;
      }
    | { readonly kind: 'get'; readonly workflowId: WorkflowId; readonly key: StateKey }
    | { readonly kind: 'list'; readonly workflowId: WorkflowId }
    | { readonly kind: 'deleteKey'; readonly workflowId: WorkflowId; readonly key: StateKey }
    | { readonly kind: 'deleteWorkflow'; readonly workflowId: WorkflowId }
    | { readonly kind: 'flush'; readonly workflowId: WorkflowId }
    | { readonly kind: 'flushAll' };

const workflowIdArbitrary = fc.constantFrom(...WORKFLOW_IDS);
const keyArbitrary = fc.constantFrom(...KEYS);
const valueArbitrary = fc.string({ minLength: 0, maxLength: 12 });

const stateOperationArbitrary: fc.Arbitrary<StateOperation> = fc.oneof(
    fc.record({
        kind: fc.constant<'set'>('set'),
        workflowId: workflowIdArbitrary,
        key: keyArbitrary,
        value: valueArbitrary,
    }),
    fc.record({
        kind: fc.constant<'setKey'>('setKey'),
        workflowId: workflowIdArbitrary,
        key: keyArbitrary,
        value: valueArbitrary,
    }),
    fc.record({
        kind: fc.constant<'get'>('get'),
        workflowId: workflowIdArbitrary,
        key: keyArbitrary,
    }),
    fc.record({ kind: fc.constant<'list'>('list'), workflowId: workflowIdArbitrary }),
    fc.record({
        kind: fc.constant<'deleteKey'>('deleteKey'),
        workflowId: workflowIdArbitrary,
        key: keyArbitrary,
    }),
    fc.record({
        kind: fc.constant<'deleteWorkflow'>('deleteWorkflow'),
        workflowId: workflowIdArbitrary,
    }),
    fc.record({ kind: fc.constant<'flush'>('flush'), workflowId: workflowIdArbitrary }),
    fc.constant({ kind: 'flushAll' as const }),
);

function assertOptionEquivalent(
    left: Option.Option<WorkflowStatePrimitive>,
    right: Option.Option<WorkflowStatePrimitive>,
): void {
    expect(Option.isSome(left)).toBe(Option.isSome(right));
    if (Option.isSome(left) && Option.isSome(right)) {
        expect(left.value).toBe(right.value);
    }
}

function sortedEntries(store: WorkflowStateStore, workflowId: WorkflowId): readonly unknown[] {
    return [...store.listKeys(workflowId)].sort((left, right) => left.key.localeCompare(right.key));
}

function assertStoresEquivalent(left: WorkflowStateStore, right: WorkflowStateStore): void {
    for (const workflowId of WORKFLOW_IDS) {
        for (const key of KEYS) {
            assertOptionEquivalent(
                left.forWorkflow(workflowId).get(key),
                right.forWorkflow(workflowId).get(key),
            );
        }
        expect(sortedEntries(left, workflowId)).toEqual(sortedEntries(right, workflowId));
    }
}

function applyWrite(store: WorkflowStateStore, operation: StateOperation): void {
    switch (operation.kind) {
        case 'set':
            store.forWorkflow(operation.workflowId).set(operation.key, operation.value);
            return;
        case 'setKey':
            store.setKey(operation.workflowId, operation.key, operation.value);
            return;
        case 'deleteKey':
            store.deleteKey(operation.workflowId, operation.key);
            return;
        case 'deleteWorkflow':
            store.deleteWorkflow(operation.workflowId);
            return;
        case 'flush':
            store.forWorkflow(operation.workflowId).flush();
            return;
        case 'flushAll':
            store.flushAll();
            return;
        case 'get':
        case 'list':
            return;
        default:
            assertNever(operation);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow State operation: ${JSON.stringify(value)}`);
}

describe('Workflow State adapter properties', () => {
    it('keeps in-memory and SQLite adapters behaviorally equivalent across generated command sequences', () => {
        fc.assert(
            fc.property(
                fc.array(stateOperationArbitrary, { minLength: 1, maxLength: 40 }),
                (operations) => {
                    const storageDir = mkdtempSync(join(tmpdir(), 'sigil-persistence-property-'));
                    const databasePath = join(storageDir, 'state.db');
                    const database = new Database(databasePath);
                    const memory = createInMemoryWorkflowStateStore();
                    const sqlite = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
                    const observedDatabase = new Database(databasePath);
                    const observedSqlite = createWorkflowStateStore(observedDatabase, {
                        flushIntervalMs: 60_000,
                    });

                    try {
                        for (const operation of operations) {
                            if (operation.kind === 'get') {
                                assertOptionEquivalent(
                                    memory.forWorkflow(operation.workflowId).get(operation.key),
                                    sqlite.forWorkflow(operation.workflowId).get(operation.key),
                                );
                            } else if (operation.kind === 'list') {
                                expect(sortedEntries(memory, operation.workflowId)).toEqual(
                                    sortedEntries(sqlite, operation.workflowId),
                                );
                            } else {
                                applyWrite(memory, operation);
                                applyWrite(sqlite, operation);
                            }

                            assertStoresEquivalent(memory, sqlite);
                            sqlite.flushAll();
                            assertStoresEquivalent(memory, observedSqlite);
                        }
                    } finally {
                        memory.dispose();
                        sqlite.dispose();
                        observedSqlite.dispose();
                        database.close();
                        observedDatabase.close();
                        rmSync(storageDir, { recursive: true, force: true });
                    }
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('preserves generated empty and overwritten values as observable adapter state', () => {
        fc.assert(
            fc.property(fc.array(valueArbitrary, { minLength: 0, maxLength: 11 }), (generated) => {
                const values = ['', ...generated];
                const database = new Database(':memory:');
                const memory = createInMemoryWorkflowStateStore();
                const sqlite = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

                try {
                    for (const value of values) {
                        const operation: StateOperation = {
                            kind: 'setKey',
                            workflowId: 'wf-a',
                            key: 'empty',
                            value,
                        };
                        applyWrite(memory, operation);
                        applyWrite(sqlite, operation);

                        for (const observed of [
                            memory.forWorkflow('wf-a').get('empty'),
                            sqlite.forWorkflow('wf-a').get('empty'),
                        ]) {
                            expect(Option.isSome(observed)).toBe(true);
                            if (Option.isSome(observed)) {
                                expect(observed.value).toBe(value);
                            }
                        }
                        assertStoresEquivalent(memory, sqlite);
                    }
                } finally {
                    memory.dispose();
                    sqlite.dispose();
                    database.close();
                }
            }),
            PROPERTY_OPTIONS,
        );
    });
});
