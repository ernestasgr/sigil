import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync as Database } from 'node:sqlite';
import { WorkflowIdSchema } from '@sigil/schema/workflow-id';

import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStatePrimitive } from './workflow-state.js';
import {
    createInMemoryWorkflowStateStore,
    createWorkflowStateStore,
    WORKFLOW_STATE_VALUE_FORMAT,
    WORKFLOW_STATE_VALUE_PREFIX,
    WORKFLOW_STATE_VALUE_VERSION,
} from './workflow-state.js';

const WF_A = WorkflowIdSchema.parse('wf-a');
const WF_B = WorkflowIdSchema.parse('wf-b');

function createStore(database: Database) {
    return createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
}

describe('createWorkflowStateStore — get/set', () => {
    it('returns undefined for a key that has never been set', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        expect(Option.isNone(state.get('missing'))).toBe(true);

        store.dispose();
        database.close();
    });

    it('isolates keys per workflow', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow(WF_A).set('k', 'a-value');
        store.forWorkflow(WF_B).set('k', 'b-value');
        store.forWorkflow(WF_A).set('count', 0);
        store.forWorkflow(WF_B).set('enabled', false);

        expect(Option.getOrThrow(store.forWorkflow(WF_A).get('k'))).toBe('a-value');
        expect(Option.getOrThrow(store.forWorkflow(WF_B).get('k'))).toBe('b-value');
        expect(Option.getOrThrow(store.forWorkflow(WF_A).get('count'))).toBe(0);
        expect(Option.getOrThrow(store.forWorkflow(WF_B).get('enabled'))).toBe(false);

        store.dispose();
        database.close();
    });

    it.each([
        ['string', 'value'],
        ['number', 42],
        ['true', true],
        ['false', false],
    ] as const)('round-trips a %s value through SQLite', (_kind, value) => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('typed', value);
        expect(state.get('typed')).toEqual(Option.some(value));

        state.flush();
        const reader = createStore(database);
        expect(reader.forWorkflow(WF_A).get('typed')).toEqual(Option.some(value));

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('stores typed values as marked versioned envelopes in the existing text column', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.forWorkflow(WF_A).set('typed', 42);
        store.forWorkflow(WF_A).flush();

        expect(
            database
                .prepare('SELECT value FROM workflow_state WHERE workflow_id = ? AND key = ?')
                .get('wf-a', 'typed'),
        ).toEqual({
            value: `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'number',
                value: 42,
            })}`,
        });

        store.dispose();
        database.close();
    });

    it('rejects unencoded database rows instead of rewriting them', () => {
        const database = new Database(':memory:');
        database.exec(`
                CREATE TABLE workflow_state (
                    workflow_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    PRIMARY KEY (workflow_id, key)
                );
            `);
        database
            .prepare('INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)')
            .run('wf-a', 'unencoded', 'value');

        const store = createStore(database);
        expect(() => store.forWorkflow(WF_A).get('unencoded')).toThrow('invalid encoded value');

        store.dispose();
        database.close();
    });

    it.each([
        ['malformed', `${WORKFLOW_STATE_VALUE_PREFIX}{`],
        [
            'invalid envelope',
            `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'number',
                value: 'not-a-number',
            })}`,
        ],
    ] as const)('rejects %s encoded database rows', (kind, value) => {
        const database = new Database(':memory:');
        const store = createStore(database);
        database
            .prepare('INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)')
            .run('wf-a', kind, value);

        expect(() => store.forWorkflow(WF_A).get(kind)).toThrow('invalid encoded value');

        store.dispose();
        database.close();
    });

    it('preserves typed values across SQLite close and reopen', () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-workflow-state-'));
        const databasePath = join(storageDir, 'state.db');

        const database = new Database(databasePath);
        const writer = createStore(database);
        writer.forWorkflow(WF_A).set('count', 42);
        writer.forWorkflow(WF_A).set('enabled', false);
        writer.dispose();
        database.close();

        const reopenedDatabase = new Database(databasePath);
        const reader = createStore(reopenedDatabase);
        expect(reader.forWorkflow(WF_A).get('count')).toEqual(Option.some(42));
        expect(reader.forWorkflow(WF_A).get('enabled')).toEqual(Option.some(false));
        reader.dispose();
        reopenedDatabase.close();
        rmSync(storageDir, { recursive: true, force: true });
    });

    it('round-trips an empty string through SQLite as a present value', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow(WF_A).set('empty', '');
        store.forWorkflow(WF_A).flush();

        expect(store.forWorkflow(WF_A).get('empty')).toEqual(Option.some(''));

        store.dispose();
        database.close();
    });

    it('rejects non-finite numbers before persistence', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('invalid', Infinity as unknown as WorkflowStatePrimitive);
        expect(() => state.flush()).toThrow('Workflow State numbers must be finite.');

        state.set('invalid', Symbol('invalid') as unknown as WorkflowStatePrimitive);
        expect(() => state.flush()).toThrow('Unhandled Workflow State value');

        state.set('invalid', 'recovered');
        state.flush();
        store.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — write coalescing', () => {
    it('makes a buffered set visible to get on the same handle without flushing', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('k', 'buffered');
        expect(Option.getOrThrow(state.get('k'))).toBe('buffered');

        store.dispose();
        database.close();
    });

    it('reads the pending buffer before SQLite so unflushed writes win', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('k', 'buffered');
        database
            .prepare(
                "INSERT INTO workflow_state (workflow_id, key, value) VALUES ('wf-a', 'k', 'sqlite-value') ON CONFLICT(workflow_id, key) DO UPDATE SET value = 'sqlite-value'",
            )
            .run();

        expect(Option.getOrThrow(state.get('k'))).toBe('buffered');

        store.dispose();
        database.close();
    });

    it('coalesces repeated sets to the same key, keeping only the latest buffered value', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('k', 'first');
        state.set('k', 'second');
        state.set('k', 'third');

        expect(Option.getOrThrow(state.get('k'))).toBe('third');

        store.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — flush', () => {
    it('persists buffered writes to SQLite so a fresh store on the same DB can read them', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow(WF_A).set('k', 'persisted');
        store.forWorkflow(WF_A).flush();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k'))).toBe('persisted');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('upserts so re-setting a key after a flush updates the persisted row', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('k', 'first');
        state.flush();
        state.set('k', 'second');
        state.flush();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k'))).toBe('second');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('clears the buffer after flushing so subsequent gets read from SQLite', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);

        state.set('k', 'persisted');
        state.flush();

        database
            .prepare('UPDATE workflow_state SET value = ? WHERE workflow_id = ? AND key = ?')
            .run(
                `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
                    format: WORKFLOW_STATE_VALUE_FORMAT,
                    version: WORKFLOW_STATE_VALUE_VERSION,
                    type: 'string',
                    value: 'overwritten',
                })}`,
                'wf-a',
                'k',
            );

        expect(Option.getOrThrow(state.get('k'))).toBe('overwritten');

        store.dispose();
        database.close();
    });

    it('flushAll persists every workflow buffer in one call', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow(WF_A).set('k1', 'a');
        store.forWorkflow(WF_B).set('k2', 'b');
        store.flushAll();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k1'))).toBe('a');
        expect(Option.getOrThrow(reader.forWorkflow(WF_B).get('k2'))).toBe('b');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('retains buffered values when a transaction fails so a later flush can retry', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow(WF_A);
        database.exec(
            "CREATE TRIGGER fail_workflow_state_insert BEFORE INSERT ON workflow_state BEGIN SELECT RAISE(ABORT, 'flush failed'); END;",
        );
        state.set('k', 'retryable');

        expect(() => state.flush()).toThrow(
            expect.objectContaining({
                cause: expect.objectContaining({ message: 'flush failed' }),
            }),
        );
        expect(state.get('k')).toEqual(Option.some('retryable'));

        database.exec('DROP TRIGGER fail_workflow_state_insert');
        state.flush();
        expect(state.get('k')).toEqual(Option.some('retryable'));

        store.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — interval flush', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes the buffer to SQLite on the configured interval', () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        const writer = createWorkflowStateStore(database, { flushIntervalMs: 250 });
        const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

        writer.forWorkflow(WF_A).set('k', 'interval');
        expect(Option.isNone(reader.forWorkflow(WF_A).get('k'))).toBe(true);

        vi.advanceTimersByTime(250);

        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k'))).toBe('interval');

        writer.dispose();
        reader.dispose();
        database.close();
    });

    it('does not flush before the interval elapses', () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        const writer = createWorkflowStateStore(database, { flushIntervalMs: 250 });
        const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

        writer.forWorkflow(WF_A).set('k', 'interval');
        vi.advanceTimersByTime(249);

        expect(Option.isNone(reader.forWorkflow(WF_A).get('k'))).toBe(true);

        writer.dispose();
        reader.dispose();
        database.close();
    });

    it('uses the default flush interval when no interval is configured', () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        const writer = createWorkflowStateStore(database);
        const reader = createStore(database);

        writer.forWorkflow(WF_A).set('k', 'default-interval');
        vi.advanceTimersByTime(249);
        expect(Option.isNone(reader.forWorkflow(WF_A).get('k'))).toBe(true);

        vi.advanceTimersByTime(1);
        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k'))).toBe('default-interval');

        writer.dispose();
        reader.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — dispose', () => {
    it('flushes pending writes and stops the interval', () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        const writer = createWorkflowStateStore(database, { flushIntervalMs: 250 });
        const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

        writer.forWorkflow(WF_A).set('k', 'on-dispose');
        writer.dispose();

        expect(Option.getOrThrow(reader.forWorkflow(WF_A).get('k'))).toBe('on-dispose');

        vi.advanceTimersByTime(1000);

        writer.forWorkflow(WF_A).set('k2', 'after-dispose');
        expect(Option.isNone(reader.forWorkflow(WF_A).get('k2'))).toBe(true);

        reader.dispose();
        database.close();
        vi.useRealTimers();
    });
});

describe('createWorkflowStateStore — persistence across executions', () => {
    it('survives disposing one store and opening another on the same database', () => {
        const database = new Database(':memory:');
        const first = createStore(database);
        first.forWorkflow(WF_A).set('last-run', '2026-06-24');
        first.forWorkflow(WF_A).flush();
        first.dispose();

        const second = createStore(database);
        expect(Option.getOrThrow(second.forWorkflow(WF_A).get('last-run'))).toBe('2026-06-24');

        second.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — listKeys / setKey / deleteKey', () => {
    it('listKeys returns an empty array when no keys exist', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        expect(store.listKeys(WF_A)).toEqual([]);
        store.dispose();
        database.close();
    });

    it('setKey writes a key and listKeys returns it', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey(WF_A, 'k', 'v');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'v' }]);
        store.dispose();
        database.close();
    });

    it('listKeys preserves the primitive type of persisted values', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.setKey(WF_A, 'count', 42);
        store.setKey(WF_A, 'enabled', false);
        store.setKey(WF_A, 'label', 'ready');

        expect(store.listKeys(WF_A)).toHaveLength(3);
        expect(store.listKeys(WF_A)).toEqual(
            expect.arrayContaining([
                { key: 'count', type: 'number', value: 42 },
                { key: 'enabled', type: 'boolean', value: false },
                { key: 'label', type: 'string', value: 'ready' },
            ]),
        );

        store.dispose();
        database.close();
    });

    it('setKey overwrites an existing key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey(WF_A, 'k', 'first');
        store.setKey(WF_A, 'k', 'second');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'second' }]);
        store.dispose();
        database.close();
    });

    it('setKey round-trips through new store on same DB', () => {
        const database = new Database(':memory:');
        const writer = createStore(database);
        writer.setKey(WF_A, 'k', 'persisted');
        const reader = createStore(database);
        expect(reader.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'persisted' }]);
        writer.dispose();
        reader.dispose();
        database.close();
    });

    it('deleteKey removes a key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey(WF_A, 'k', 'v');
        store.deleteKey(WF_A, 'k');
        expect(store.listKeys(WF_A)).toEqual([]);
        store.dispose();
        database.close();
    });

    it('deleteKey does not throw when deleting a non-existent key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        expect(() => store.deleteKey(WF_A, 'missing')).not.toThrow();
        store.dispose();
        database.close();
    });

    it('deleteKey flushes pending buffer before deleting so key is not resurrected', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.forWorkflow(WF_A).set('k', 'buffered');
        store.deleteKey(WF_A, 'k');
        expect(store.listKeys(WF_A)).toEqual([]);
        store.dispose();
        database.close();
    });

    it('listKeys isolates keys per workflow', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey(WF_A, 'ka', 'a');
        store.setKey(WF_B, 'kb', 'b');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'ka', type: 'string', value: 'a' }]);
        expect(store.listKeys(WF_B)).toEqual([{ key: 'kb', type: 'string', value: 'b' }]);
        store.dispose();
        database.close();
    });

    it('deletes persisted and pending state for one Workflow without touching another', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.setKey(WF_A, 'persisted', 'a');
        store.forWorkflow(WF_A).set('pending', 'a-pending');
        store.setKey(WF_B, 'survivor', 'b');

        store.deleteWorkflow(WF_A);
        store.flushAll();

        expect(store.listKeys(WF_A)).toEqual([]);
        expect(store.listKeys(WF_B)).toEqual([{ key: 'survivor', type: 'string', value: 'b' }]);

        store.dispose();
        database.close();
    });

    it('does not resurrect pending state after a failed Workflow deletion', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey(WF_A, 'persisted', 'a');
        store.forWorkflow(WF_A).set('pending', 'a-pending');
        database.exec(
            "CREATE TRIGGER fail_workflow_state_delete BEFORE DELETE ON workflow_state BEGIN SELECT RAISE(ABORT, 'delete failed'); END;",
        );

        expect(() => store.deleteWorkflow(WF_A)).toThrow(
            expect.objectContaining({
                cause: expect.objectContaining({ message: 'delete failed' }),
            }),
        );

        database.exec('DROP TRIGGER fail_workflow_state_delete');
        store.flushAll();

        expect(store.listKeys(WF_A)).toEqual([{ key: 'persisted', type: 'string', value: 'a' }]);

        store.dispose();
        database.close();
    });
});

describe('createInMemoryWorkflowStateStore — listKeys / setKey / deleteKey', () => {
    it('supports the no-op flush and dispose methods', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow(WF_A);

        expect(() => state.flush()).not.toThrow();
        expect(() => store.dispose()).not.toThrow();
    });

    it.each([
        ['string', 'value'],
        ['number', 0],
        ['true', true],
        ['false', false],
    ] as const)('round-trips a %s value without SQLite', (_kind, value) => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow(WF_A);

        state.set('typed', value);

        expect(state.get('typed')).toEqual(Option.some(value));
        expect(store.listKeys(WF_A)).toEqual([
            {
                key: 'typed',
                type: typeof value,
                value,
            },
        ]);
    });

    it('round-trips missing, empty, and non-empty values consistently', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow(WF_A);

        expect(state.get('missing')).toEqual(Option.none());
        state.set('empty', '');
        state.set('value', 'present');

        expect(state.get('empty')).toEqual(Option.some(''));
        expect(state.get('value')).toEqual(Option.some('present'));
    });

    it('listKeys returns an empty array when no keys exist', () => {
        const store = createInMemoryWorkflowStateStore();
        expect(store.listKeys(WF_A)).toEqual([]);
    });

    it('keeps pending state unchanged when flushAll is called', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'k', 'v');

        store.flushAll();

        expect(store.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'v' }]);
    });

    it('rejects invalid in-memory primitives at the entry boundary', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'invalid', {} as unknown as WorkflowStatePrimitive);

        expect(() => store.listKeys(WF_A)).toThrow('Unhandled Workflow State value');
    });

    it('setKey writes a key and listKeys returns it', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'k', 'v');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'v' }]);
    });

    it('setKey overwrites an existing key', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'k', 'first');
        store.setKey(WF_A, 'k', 'second');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'k', type: 'string', value: 'second' }]);
    });

    it('deleteKey removes a key', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'k', 'v');
        store.deleteKey(WF_A, 'k');
        expect(store.listKeys(WF_A)).toEqual([]);
    });

    it('deleteKey does not throw when deleting a non-existent key', () => {
        const store = createInMemoryWorkflowStateStore();
        expect(() => store.deleteKey(WF_A, 'missing')).not.toThrow();
    });

    it('listKeys isolates keys per workflow', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey(WF_A, 'ka', 'a');
        store.setKey(WF_B, 'kb', 'b');
        expect(store.listKeys(WF_A)).toEqual([{ key: 'ka', type: 'string', value: 'a' }]);
        expect(store.listKeys(WF_B)).toEqual([{ key: 'kb', type: 'string', value: 'b' }]);
    });

    it('deletes pending state for one Workflow without touching another', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow(WF_A);
        state.set('removed', 'a');
        store.setKey(WF_B, 'survivor', 'b');

        store.deleteWorkflow(WF_A);

        expect(state.get('removed')).toEqual(Option.none());
        expect(store.listKeys(WF_A)).toEqual([]);
        expect(store.listKeys(WF_B)).toEqual([{ key: 'survivor', type: 'string', value: 'b' }]);
    });
});
