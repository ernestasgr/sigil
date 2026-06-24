import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowStateStore } from './workflow-state.js';

function createStore(database: Database.Database) {
    return createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
}

describe('createWorkflowStateStore — get/set', () => {
    it('returns undefined for a key that has never been set', () => {
        const database = new Database(':memory:');
        const store = createStore(database);
        const state = store.forWorkflow('wf-a');

        expect(state.get('missing')).toBeUndefined();

        store.dispose();
        database.close();
    });

    it('isolates keys per workflow', () => {
        const database = new Database(':memory:');
        const store = createStore(database);

        store.forWorkflow('wf-a').set('k', 'a-value');
        store.forWorkflow('wf-b').set('k', 'b-value');

        expect(store.forWorkflow('wf-a').get('k')).toBe('a-value');
        expect(store.forWorkflow('wf-b').get('k')).toBe('b-value');

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
        expect(state.get('k')).toBe('buffered');

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

        expect(state.get('k')).toBe('buffered');

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

        expect(state.get('k')).toBe('third');

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
        expect(reader.forWorkflow('wf-a').get('k')).toBe('persisted');

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
        expect(reader.forWorkflow('wf-a').get('k')).toBe('second');

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

        expect(state.get('k')).toBe('overwritten');

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
        expect(reader.forWorkflow('wf-a').get('k1')).toBe('a');
        expect(reader.forWorkflow('wf-b').get('k2')).toBe('b');

        store.dispose();
        reader.dispose();
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
        expect(reader.forWorkflow('wf-a').get('k')).toBeUndefined();

        vi.advanceTimersByTime(250);

        expect(reader.forWorkflow('wf-a').get('k')).toBe('interval');

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

        expect(reader.forWorkflow('wf-a').get('k')).toBeUndefined();

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

        expect(reader.forWorkflow('wf-a').get('k')).toBe('on-dispose');

        vi.advanceTimersByTime(1000);

        writer.forWorkflow('wf-a').set('k2', 'after-dispose');
        expect(reader.forWorkflow('wf-a').get('k2')).toBeUndefined();

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
        expect(second.forWorkflow('wf-a').get('last-run')).toBe('2026-06-24');

        second.dispose();
        database.close();
    });
});
