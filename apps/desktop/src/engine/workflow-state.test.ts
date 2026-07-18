import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
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

function createStore(database: Database.Database) {
    return createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
}

describe('createWorkflowStateStore — get/set', () => {
    it('returns undefined for a key that has never been set', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

        expect(Option.isNone(state.get('missing'))).toBe(true);

        store.dispose();
        database.close();
    });

    it('isolates keys per workflow', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow('wf-a').set('k', 'a-value');
        store.forWorkflow('wf-b').set('k', 'b-value');
        store.forWorkflow('wf-a').set('count', 0);
        store.forWorkflow('wf-b').set('enabled', false);

        expect(Option.getOrThrow(store.forWorkflow('wf-a').get('k'))).toBe('a-value');
        expect(Option.getOrThrow(store.forWorkflow('wf-b').get('k'))).toBe('b-value');
        expect(Option.getOrThrow(store.forWorkflow('wf-a').get('count'))).toBe(0);
        expect(Option.getOrThrow(store.forWorkflow('wf-b').get('enabled'))).toBe(false);

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
        const state = store.forWorkflow('wf-a');

        state.set('typed', value);
        expect(state.get('typed')).toEqual(Option.some(value));

        state.flush();
        const reader = createStore(database);
        expect(reader.forWorkflow('wf-a').get('typed')).toEqual(Option.some(value));

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('stores typed values as marked versioned envelopes in the existing text column', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.forWorkflow('wf-a').set('typed', 42);
        store.forWorkflow('wf-a').flush();

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

    it('reads legacy bare strings without re-typing them', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        database
            .prepare('INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)')
            .run('wf-a', 'empty', '');
        database
            .prepare('INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)')
            .run('wf-a', 'number-looking', '42');
        database
            .prepare('INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)')
            .run('wf-a', 'boolean-looking', 'false');

        const state = store.forWorkflow('wf-a');
        expect(state.get('empty')).toEqual(Option.some(''));
        expect(state.get('number-looking')).toEqual(Option.some('42'));
        expect(state.get('boolean-looking')).toEqual(Option.some('false'));

        store.dispose();
        database.close();
    });

    it('migrates envelope-shaped legacy strings before decoding and preserves encoded rows', () => {
        const database = new Database(':memory:');
        database.exec(`
            CREATE TABLE workflow_state (
                workflow_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (workflow_id, key)
            );
        `);

        const legacyEnvelope = JSON.stringify({
            format: WORKFLOW_STATE_VALUE_FORMAT,
            version: WORKFLOW_STATE_VALUE_VERSION,
            type: 'number',
            value: 7,
        });
        const encodedTypedValue = `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
            format: WORKFLOW_STATE_VALUE_FORMAT,
            version: WORKFLOW_STATE_VALUE_VERSION,
            type: 'number',
            value: 42,
        })}`;
        const malformedEncodedValue = `${WORKFLOW_STATE_VALUE_PREFIX}not-json`;
        const invalidEncodedValue = `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
            format: WORKFLOW_STATE_VALUE_FORMAT,
            version: WORKFLOW_STATE_VALUE_VERSION,
            type: 'number',
            value: '42',
        })}`;
        const insert = database.prepare(
            'INSERT INTO workflow_state (workflow_id, key, value) VALUES (?, ?, ?)',
        );
        insert.run('wf-a', 'legacy-envelope', legacyEnvelope);
        insert.run('wf-a', 'typed', encodedTypedValue);
        insert.run('wf-a', 'malformed', malformedEncodedValue);
        insert.run('wf-a', 'invalid', invalidEncodedValue);

        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

        expect(state.get('legacy-envelope')).toEqual(Option.some(legacyEnvelope));
        expect(state.get('typed')).toEqual(Option.some(42));
        expect(state.get('malformed')).toEqual(Option.some(malformedEncodedValue));
        expect(state.get('invalid')).toEqual(Option.some(invalidEncodedValue));
        expect(
            database
                .prepare('SELECT value FROM workflow_state WHERE workflow_id = ? AND key = ?')
                .get('wf-a', 'legacy-envelope'),
        ).toEqual({
            value: `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify({
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'string',
                value: legacyEnvelope,
            })}`,
        });
        expect(
            database
                .prepare('SELECT value FROM workflow_state WHERE workflow_id = ? AND key = ?')
                .get('wf-a', 'typed'),
        ).toEqual({ value: encodedTypedValue });
        expect(
            database
                .prepare('SELECT value FROM workflow_state_metadata WHERE key = ?')
                .get('typed-value-envelope-v1'),
        ).toEqual({ value: 'complete' });

        store.dispose();
        database.close();
    });

    it('preserves typed values across SQLite close and reopen', () => {
        const storageDir = mkdtempSync(join(tmpdir(), 'sigil-workflow-state-'));
        const databasePath = join(storageDir, 'state.db');

        const database = new Database(databasePath);
        const writer = createStore(database);
        writer.forWorkflow('wf-a').set('count', 42);
        writer.forWorkflow('wf-a').set('enabled', false);
        writer.dispose();
        database.close();

        const reopenedDatabase = new Database(databasePath);
        const reader = createStore(reopenedDatabase);
        expect(reader.forWorkflow('wf-a').get('count')).toEqual(Option.some(42));
        expect(reader.forWorkflow('wf-a').get('enabled')).toEqual(Option.some(false));
        reader.dispose();
        reopenedDatabase.close();
        rmSync(storageDir, { recursive: true, force: true });
    });

    it('round-trips an empty string through SQLite as a present value', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow('wf-a').set('empty', '');
        store.forWorkflow('wf-a').flush();

        expect(store.forWorkflow('wf-a').get('empty')).toEqual(Option.some(''));

        store.dispose();
        database.close();
    });

    it('rejects non-finite numbers before persistence', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

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
        const state = store.forWorkflow('wf-a');

        state.set('k', 'buffered');
        expect(Option.getOrThrow(state.get('k'))).toBe('buffered');

        store.dispose();
        database.close();
    });

    it('reads the pending buffer before SQLite so unflushed writes win', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

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
        const state = store.forWorkflow('wf-a');

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

        store.forWorkflow('wf-a').set('k', 'persisted');
        store.forWorkflow('wf-a').flush();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow('wf-a').get('k'))).toBe('persisted');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('upserts so re-setting a key after a flush updates the persisted row', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

        state.set('k', 'first');
        state.flush();
        state.set('k', 'second');
        state.flush();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow('wf-a').get('k'))).toBe('second');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('clears the buffer after flushing so subsequent gets read from SQLite', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

        state.set('k', 'persisted');
        state.flush();

        database
            .prepare(
                "UPDATE workflow_state SET value = 'overwritten' WHERE workflow_id = 'wf-a' AND key = 'k'",
            )
            .run();

        expect(Option.getOrThrow(state.get('k'))).toBe('overwritten');

        store.dispose();
        database.close();
    });

    it('flushAll persists every workflow buffer in one call', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow('wf-a').set('k1', 'a');
        store.forWorkflow('wf-b').set('k2', 'b');
        store.flushAll();

        const reader = createStore(database);
        expect(Option.getOrThrow(reader.forWorkflow('wf-a').get('k1'))).toBe('a');
        expect(Option.getOrThrow(reader.forWorkflow('wf-b').get('k2'))).toBe('b');

        store.dispose();
        reader.dispose();
        database.close();
    });

    it('retains buffered values when a transaction fails so a later flush can retry', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');
        database.exec(
            "CREATE TRIGGER fail_workflow_state_insert BEFORE INSERT ON workflow_state BEGIN SELECT RAISE(ABORT, 'flush failed'); END;",
        );
        state.set('k', 'retryable');

        expect(() => state.flush()).toThrow('flush failed');
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

        writer.forWorkflow('wf-a').set('k', 'interval');
        expect(Option.isNone(reader.forWorkflow('wf-a').get('k'))).toBe(true);

        vi.advanceTimersByTime(250);

        expect(Option.getOrThrow(reader.forWorkflow('wf-a').get('k'))).toBe('interval');

        writer.dispose();
        reader.dispose();
        database.close();
    });

    it('does not flush before the interval elapses', () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        const writer = createWorkflowStateStore(database, { flushIntervalMs: 250 });
        const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });

        writer.forWorkflow('wf-a').set('k', 'interval');
        vi.advanceTimersByTime(249);

        expect(Option.isNone(reader.forWorkflow('wf-a').get('k'))).toBe(true);

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

        writer.forWorkflow('wf-a').set('k', 'on-dispose');
        writer.dispose();

        expect(Option.getOrThrow(reader.forWorkflow('wf-a').get('k'))).toBe('on-dispose');

        vi.advanceTimersByTime(1000);

        writer.forWorkflow('wf-a').set('k2', 'after-dispose');
        expect(Option.isNone(reader.forWorkflow('wf-a').get('k2'))).toBe(true);

        reader.dispose();
        database.close();
        vi.useRealTimers();
    });
});

describe('createWorkflowStateStore — persistence across executions', () => {
    it('survives disposing one store and opening another on the same database', () => {
        const database = new Database(':memory:');
        const first = createStore(database);
        first.forWorkflow('wf-a').set('last-run', '2026-06-24');
        first.forWorkflow('wf-a').flush();
        first.dispose();

        const second = createStore(database);
        expect(Option.getOrThrow(second.forWorkflow('wf-a').get('last-run'))).toBe('2026-06-24');

        second.dispose();
        database.close();
    });
});

describe('createWorkflowStateStore — listKeys / setKey / deleteKey', () => {
    it('listKeys returns an empty array when no keys exist', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        expect(store.listKeys('wf-a')).toEqual([]);
        store.dispose();
        database.close();
    });

    it('setKey writes a key and listKeys returns it', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'k', 'v');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', type: 'string', value: 'v' }]);
        store.dispose();
        database.close();
    });

    it('setKey overwrites an existing key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'k', 'first');
        store.setKey('wf-a', 'k', 'second');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', type: 'string', value: 'second' }]);
        store.dispose();
        database.close();
    });

    it('setKey round-trips through new store on same DB', () => {
        const database = new Database(':memory:');
        const writer = createStore(database);
        writer.setKey('wf-a', 'k', 'persisted');
        const reader = createStore(database);
        expect(reader.listKeys('wf-a')).toEqual([{ key: 'k', type: 'string', value: 'persisted' }]);
        writer.dispose();
        reader.dispose();
        database.close();
    });

    it('deleteKey removes a key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'k', 'v');
        store.deleteKey('wf-a', 'k');
        expect(store.listKeys('wf-a')).toEqual([]);
        store.dispose();
        database.close();
    });

    it('deleteKey does not throw when deleting a non-existent key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        expect(() => store.deleteKey('wf-a', 'missing')).not.toThrow();
        store.dispose();
        database.close();
    });

    it('deleteKey flushes pending buffer before deleting so key is not resurrected', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.forWorkflow('wf-a').set('k', 'buffered');
        store.deleteKey('wf-a', 'k');
        expect(store.listKeys('wf-a')).toEqual([]);
        store.dispose();
        database.close();
    });

    it('listKeys isolates keys per workflow', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'ka', 'a');
        store.setKey('wf-b', 'kb', 'b');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'ka', type: 'string', value: 'a' }]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'kb', type: 'string', value: 'b' }]);
        store.dispose();
        database.close();
    });

    it('deletes persisted and pending state for one Workflow without touching another', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.setKey('wf-a', 'persisted', 'a');
        store.forWorkflow('wf-a').set('pending', 'a-pending');
        store.setKey('wf-b', 'survivor', 'b');

        store.deleteWorkflow('wf-a');
        store.flushAll();

        expect(store.listKeys('wf-a')).toEqual([]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'survivor', type: 'string', value: 'b' }]);

        store.dispose();
        database.close();
    });

    it('does not resurrect pending state after a failed Workflow deletion', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'persisted', 'a');
        store.forWorkflow('wf-a').set('pending', 'a-pending');
        database.exec(
            "CREATE TRIGGER fail_workflow_state_delete BEFORE DELETE ON workflow_state BEGIN SELECT RAISE(ABORT, 'delete failed'); END;",
        );

        expect(() => store.deleteWorkflow('wf-a')).toThrow('delete failed');

        database.exec('DROP TRIGGER fail_workflow_state_delete');
        store.flushAll();

        expect(store.listKeys('wf-a')).toEqual([{ key: 'persisted', type: 'string', value: 'a' }]);

        store.dispose();
        database.close();
    });
});

describe('createInMemoryWorkflowStateStore — listKeys / setKey / deleteKey', () => {
    it.each([
        ['string', 'value'],
        ['number', 0],
        ['true', true],
        ['false', false],
    ] as const)('round-trips a %s value without SQLite', (_kind, value) => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow('wf-a');

        state.set('typed', value);

        expect(state.get('typed')).toEqual(Option.some(value));
        expect(store.listKeys('wf-a')).toEqual([
            {
                key: 'typed',
                type: typeof value,
                value,
            },
        ]);
    });

    it('round-trips missing, empty, and non-empty values consistently', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow('wf-a');

        expect(state.get('missing')).toEqual(Option.none());
        state.set('empty', '');
        state.set('value', 'present');

        expect(state.get('empty')).toEqual(Option.some(''));
        expect(state.get('value')).toEqual(Option.some('present'));
    });

    it('listKeys returns an empty array when no keys exist', () => {
        const store = createInMemoryWorkflowStateStore();
        expect(store.listKeys('wf-a')).toEqual([]);
    });

    it('rejects invalid in-memory primitives at the entry boundary', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'invalid', {} as unknown as WorkflowStatePrimitive);

        expect(() => store.listKeys('wf-a')).toThrow('Unhandled Workflow State value');
    });

    it('setKey writes a key and listKeys returns it', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'k', 'v');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', type: 'string', value: 'v' }]);
    });

    it('setKey overwrites an existing key', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'k', 'first');
        store.setKey('wf-a', 'k', 'second');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', type: 'string', value: 'second' }]);
    });

    it('deleteKey removes a key', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'k', 'v');
        store.deleteKey('wf-a', 'k');
        expect(store.listKeys('wf-a')).toEqual([]);
    });

    it('deleteKey does not throw when deleting a non-existent key', () => {
        const store = createInMemoryWorkflowStateStore();
        expect(() => store.deleteKey('wf-a', 'missing')).not.toThrow();
    });

    it('listKeys isolates keys per workflow', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'ka', 'a');
        store.setKey('wf-b', 'kb', 'b');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'ka', type: 'string', value: 'a' }]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'kb', type: 'string', value: 'b' }]);
    });

    it('deletes pending state for one Workflow without touching another', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow('wf-a');
        state.set('removed', 'a');
        store.setKey('wf-b', 'survivor', 'b');

        store.deleteWorkflow('wf-a');

        expect(state.get('removed')).toEqual(Option.none());
        expect(store.listKeys('wf-a')).toEqual([]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'survivor', type: 'string', value: 'b' }]);
    });
});
