import Database from 'better-sqlite3';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInMemoryWorkflowStateStore, createWorkflowStateStore } from './workflow-state.js';

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

        expect(Option.getOrThrow(store.forWorkflow('wf-a').get('k'))).toBe('a-value');
        expect(Option.getOrThrow(store.forWorkflow('wf-b').get('k'))).toBe('b-value');

        store.dispose();
        database.close();
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
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', value: 'v' }]);
        store.dispose();
        database.close();
    });

    it('setKey overwrites an existing key', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        store.setKey('wf-a', 'k', 'first');
        store.setKey('wf-a', 'k', 'second');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', value: 'second' }]);
        store.dispose();
        database.close();
    });

    it('setKey round-trips through new store on same DB', () => {
        const database = new Database(':memory:');
        const writer = createStore(database);
        writer.setKey('wf-a', 'k', 'persisted');
        const reader = createStore(database);
        expect(reader.listKeys('wf-a')).toEqual([{ key: 'k', value: 'persisted' }]);
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
        expect(store.listKeys('wf-a')).toEqual([{ key: 'ka', value: 'a' }]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'kb', value: 'b' }]);
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
        expect(store.listKeys('wf-b')).toEqual([{ key: 'survivor', value: 'b' }]);

        store.dispose();
        database.close();
    });
});

describe('createInMemoryWorkflowStateStore — listKeys / setKey / deleteKey', () => {
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

    it('setKey writes a key and listKeys returns it', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'k', 'v');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', value: 'v' }]);
    });

    it('setKey overwrites an existing key', () => {
        const store = createInMemoryWorkflowStateStore();
        store.setKey('wf-a', 'k', 'first');
        store.setKey('wf-a', 'k', 'second');
        expect(store.listKeys('wf-a')).toEqual([{ key: 'k', value: 'second' }]);
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
        expect(store.listKeys('wf-a')).toEqual([{ key: 'ka', value: 'a' }]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'kb', value: 'b' }]);
    });

    it('deletes pending state for one Workflow without touching another', () => {
        const store = createInMemoryWorkflowStateStore();
        const state = store.forWorkflow('wf-a');
        state.set('removed', 'a');
        store.setKey('wf-b', 'survivor', 'b');

        store.deleteWorkflow('wf-a');

        expect(state.get('removed')).toEqual(Option.none());
        expect(store.listKeys('wf-a')).toEqual([]);
        expect(store.listKeys('wf-b')).toEqual([{ key: 'survivor', value: 'b' }]);
    });
});
