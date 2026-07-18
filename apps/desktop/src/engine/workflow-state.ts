import type { Database } from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Option } from 'effect';
import { z } from 'zod';

import type {
    WorkflowStateEntry,
    WorkflowStatePrimitive,
    WorkflowStateValue,
    WorkflowStateValueType,
} from '../shared/ipc-channels.js';

export type {
    WorkflowStateEntry,
    WorkflowStatePrimitive,
    WorkflowStateValue,
    WorkflowStateValueType,
};

export const workflowStateTable = sqliteTable(
    'workflow_state',
    {
        workflowId: text('workflow_id').notNull(),
        key: text('key').notNull(),
        value: text('value').notNull(),
    },
    (table) => [primaryKey({ columns: [table.workflowId, table.key] })],
);

export interface WorkflowState {
    readonly get: (key: string) => Option.Option<WorkflowStatePrimitive>;
    readonly set: (key: string, value: WorkflowStatePrimitive) => void;
    readonly flush: () => void;
}

export interface WorkflowStateStore {
    readonly forWorkflow: (workflowId: string) => WorkflowState;
    readonly listKeys: (workflowId: string) => readonly WorkflowStateEntry[];
    readonly setKey: (workflowId: string, key: string, value: WorkflowStatePrimitive) => void;
    readonly deleteKey: (workflowId: string, key: string) => void;
    readonly deleteWorkflow: (workflowId: string) => void;
    readonly flushAll: () => void;
    readonly dispose: () => void;
}

export interface CreateWorkflowStateStoreOptions {
    readonly flushIntervalMs?: number;
}

/**
 * New values are stored in the existing TEXT column as a marked, versioned
 * JSON envelope. The prefix keeps the envelope distinguishable from a
 * legacy string whose contents happen to be valid envelope JSON.
 */
export const WORKFLOW_STATE_VALUE_FORMAT = 'sigil.workflow-state';
export const WORKFLOW_STATE_VALUE_VERSION = 1 as const;
export const WORKFLOW_STATE_VALUE_PREFIX = `${WORKFLOW_STATE_VALUE_FORMAT}:v${WORKFLOW_STATE_VALUE_VERSION}:`;

const EncodedWorkflowStateValueSchema = z.discriminatedUnion('type', [
    z
        .object({
            format: z.literal(WORKFLOW_STATE_VALUE_FORMAT),
            version: z.literal(WORKFLOW_STATE_VALUE_VERSION),
            type: z.literal('string'),
            value: z.string(),
        })
        .strict(),
    z
        .object({
            format: z.literal(WORKFLOW_STATE_VALUE_FORMAT),
            version: z.literal(WORKFLOW_STATE_VALUE_VERSION),
            type: z.literal('number'),
            value: z.number().finite(),
        })
        .strict(),
    z
        .object({
            format: z.literal(WORKFLOW_STATE_VALUE_FORMAT),
            version: z.literal(WORKFLOW_STATE_VALUE_VERSION),
            type: z.literal('boolean'),
            value: z.boolean(),
        })
        .strict(),
]);

type EncodedWorkflowStateValue = z.infer<typeof EncodedWorkflowStateValueSchema>;

const DEFAULT_FLUSH_INTERVAL_MS = 250;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workflow_state (
    workflow_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workflow_id, key)
);
`;

const CREATE_MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workflow_state_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

const WORKFLOW_STATE_MIGRATION_KEY = 'typed-value-envelope-v1';
const WORKFLOW_STATE_MIGRATION_COMPLETE = 'complete';

const WorkflowStateRowSchema = z.object({
    workflow_id: z.string(),
    key: z.string(),
    value: z.string(),
});

function assertNever(value: never): never {
    throw new Error(`Unhandled Workflow State value: ${JSON.stringify(value)}`);
}

function encodeWorkflowStateValue(value: WorkflowStatePrimitive): string {
    let envelope: EncodedWorkflowStateValue;
    switch (typeof value) {
        case 'string':
            envelope = {
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'string',
                value,
            };
            break;
        case 'number':
            if (!Number.isFinite(value)) {
                throw new Error('Workflow State numbers must be finite.');
            }
            envelope = {
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'number',
                value,
            };
            break;
        case 'boolean':
            envelope = {
                format: WORKFLOW_STATE_VALUE_FORMAT,
                version: WORKFLOW_STATE_VALUE_VERSION,
                type: 'boolean',
                value,
            };
            break;
        default:
            return assertNever(value);
    }
    return `${WORKFLOW_STATE_VALUE_PREFIX}${JSON.stringify(envelope)}`;
}

function parseEncodedWorkflowStateValue(raw: string): EncodedWorkflowStateValue | undefined {
    if (!raw.startsWith(WORKFLOW_STATE_VALUE_PREFIX)) return undefined;

    let candidate: unknown;
    try {
        candidate = JSON.parse(raw.slice(WORKFLOW_STATE_VALUE_PREFIX.length));
    } catch {
        return undefined;
    }

    const parsed = EncodedWorkflowStateValueSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

function decodeWorkflowStateValue(raw: string): WorkflowStatePrimitive {
    return parseEncodedWorkflowStateValue(raw)?.value ?? raw;
}

function migrateLegacyWorkflowState(database: Database): void {
    database.exec(CREATE_MIGRATION_TABLE_SQL);

    const marker = z
        .object({ value: z.string() })
        .safeParse(
            database
                .prepare('SELECT value FROM workflow_state_metadata WHERE key = ?')
                .get(WORKFLOW_STATE_MIGRATION_KEY),
        );
    if (marker.success && marker.data.value === WORKFLOW_STATE_MIGRATION_COMPLETE) return;

    const migrate = database.transaction(() => {
        const rows = database
            .prepare('SELECT workflow_id, key, value FROM workflow_state')
            .all();
        const update = database.prepare(
            'UPDATE workflow_state SET value = ? WHERE workflow_id = ? AND key = ?',
        );

        for (const rawRow of rows) {
            const row = WorkflowStateRowSchema.parse(rawRow);
            if (parseEncodedWorkflowStateValue(row.value)) continue;
            update.run(encodeWorkflowStateValue(row.value), row.workflow_id, row.key);
        }

        database
            .prepare(
                `INSERT INTO workflow_state_metadata (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            )
            .run(WORKFLOW_STATE_MIGRATION_KEY, WORKFLOW_STATE_MIGRATION_COMPLETE);
    });

    migrate();
}

function workflowStateEntry(key: string, value: WorkflowStatePrimitive): WorkflowStateEntry {
    switch (typeof value) {
        case 'string':
            return { key, type: 'string', value };
        case 'number':
            return { key, type: 'number', value };
        case 'boolean':
            return { key, type: 'boolean', value };
        default:
            return assertNever(value);
    }
}

export function createWorkflowStateStore(
    database: Database,
    options?: CreateWorkflowStateStoreOptions,
): WorkflowStateStore {
    database.exec(CREATE_TABLE_SQL);
    migrateLegacyWorkflowState(database);
    const db = drizzle(database);
    const buffer = new Map<string, Map<string, WorkflowStatePrimitive>>();
    const flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    const upsert = database.transaction(
        (entries: ReadonlyMap<string, WorkflowStatePrimitive>, workflowId: string) => {
            for (const [key, value] of entries) {
                const encodedValue = encodeWorkflowStateValue(value);
                db.insert(workflowStateTable)
                    .values({ workflowId, key, value: encodedValue })
                    .onConflictDoUpdate({
                        target: [workflowStateTable.workflowId, workflowStateTable.key],
                        set: { value: encodedValue },
                    })
                    .run();
            }
        },
    );

    function flushWorkflow(workflowId: string): void {
        const entries = buffer.get(workflowId);
        if (!entries || entries.size === 0) return;
        upsert(entries, workflowId);
        buffer.delete(workflowId);
    }

    function flushAll(): void {
        for (const workflowId of [...buffer.keys()]) {
            flushWorkflow(workflowId);
        }
    }

    const timer: ReturnType<typeof setInterval> = setInterval(flushAll, flushIntervalMs);
    timer.unref?.();

    function forWorkflow(workflowId: string): WorkflowState {
        return {
            get(key: string): Option.Option<WorkflowStatePrimitive> {
                const pendingValue = buffer.get(workflowId)?.get(key);
                if (pendingValue !== undefined) return Option.some(pendingValue);
                const row = db
                    .select({ value: workflowStateTable.value })
                    .from(workflowStateTable)
                    .where(
                        and(
                            eq(workflowStateTable.workflowId, workflowId),
                            eq(workflowStateTable.key, key),
                        ),
                    )
                    .get();
                return row !== undefined
                    ? Option.some(decodeWorkflowStateValue(row.value))
                    : Option.none();
            },
            set(key: string, value: WorkflowStatePrimitive): void {
                let pending = buffer.get(workflowId);
                if (!pending) {
                    pending = new Map();
                    buffer.set(workflowId, pending);
                }
                pending.set(key, value);
            },
            flush(): void {
                flushWorkflow(workflowId);
            },
        };
    }

    function dispose(): void {
        clearInterval(timer);
        flushAll();
    }

    function listKeys(workflowId: string): readonly WorkflowStateEntry[] {
        flushWorkflow(workflowId);
        const rows = db
            .select({ key: workflowStateTable.key, value: workflowStateTable.value })
            .from(workflowStateTable)
            .where(eq(workflowStateTable.workflowId, workflowId))
            .all();
        return rows.map((row) => workflowStateEntry(row.key, decodeWorkflowStateValue(row.value)));
    }

    function setKey(workflowId: string, key: string, value: WorkflowStatePrimitive): void {
        const pending = buffer.get(workflowId) ?? new Map<string, WorkflowStatePrimitive>();
        pending.set(key, value);
        buffer.set(workflowId, pending);
        flushWorkflow(workflowId);
    }

    function deleteKey(workflowId: string, key: string): void {
        flushWorkflow(workflowId);
        db.delete(workflowStateTable)
            .where(
                and(eq(workflowStateTable.workflowId, workflowId), eq(workflowStateTable.key, key)),
            )
            .run();
    }

    function deleteWorkflow(workflowId: string): void {
        buffer.delete(workflowId);
        db.delete(workflowStateTable).where(eq(workflowStateTable.workflowId, workflowId)).run();
    }

    return { forWorkflow, listKeys, setKey, deleteKey, deleteWorkflow, flushAll, dispose };
}

export function createInMemoryWorkflowStateStore(): WorkflowStateStore {
    const buffer = new Map<string, Map<string, WorkflowStatePrimitive>>();

    function forWorkflow(workflowId: string): WorkflowState {
        return {
            get: (key: string): Option.Option<WorkflowStatePrimitive> => {
                const val = buffer.get(workflowId)?.get(key);
                return val !== undefined ? Option.some(val) : Option.none();
            },
            set: (key: string, value: WorkflowStatePrimitive): void => {
                const pending = buffer.get(workflowId) ?? new Map<string, WorkflowStatePrimitive>();
                pending.set(key, value);
                buffer.set(workflowId, pending);
            },
            flush: (): void => {},
        };
    }

    function listKeys(workflowId: string): readonly WorkflowStateEntry[] {
        const pending = buffer.get(workflowId);
        if (!pending) return [];
        return Array.from(pending.entries()).map(([key, value]) => workflowStateEntry(key, value));
    }

    function setKey(workflowId: string, key: string, value: WorkflowStatePrimitive): void {
        const pending = buffer.get(workflowId) ?? new Map<string, WorkflowStatePrimitive>();
        pending.set(key, value);
        buffer.set(workflowId, pending);
    }

    function deleteKey(workflowId: string, key: string): void {
        const pending = buffer.get(workflowId);
        if (pending) {
            pending.delete(key);
        }
    }

    function deleteWorkflow(workflowId: string): void {
        buffer.delete(workflowId);
    }

    return {
        forWorkflow,
        listKeys,
        setKey,
        deleteKey,
        deleteWorkflow,
        flushAll: (): void => {},
        dispose: (): void => {},
    };
}
