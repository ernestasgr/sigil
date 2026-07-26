import type { DatabaseSync } from 'node:sqlite';
import type { WorkflowId } from '@sigil/schema/ids';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Option } from 'effect';
import { z } from 'zod';
import type {
    WorkflowStateEntry,
    WorkflowStatePrimitive,
    WorkflowStateValue,
    WorkflowStateValueType,
} from '../../shared/ipc-channels.js';

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
    readonly forWorkflow: (workflowId: WorkflowId) => WorkflowState;
    readonly listKeys: (workflowId: WorkflowId) => readonly WorkflowStateEntry[];
    readonly setKey: (workflowId: WorkflowId, key: string, value: WorkflowStatePrimitive) => void;
    readonly deleteKey: (workflowId: WorkflowId, key: string) => void;
    readonly deleteWorkflow: (workflowId: WorkflowId) => void;
    readonly flushAll: () => void;
    readonly dispose: () => void;
}

export interface CreateWorkflowStateStoreOptions {
    readonly flushIntervalMs?: number;
}

/** Values are stored in the TEXT column as a marked, versioned JSON envelope. */
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
    const parsed = parseEncodedWorkflowStateValue(raw);
    if (parsed === undefined) {
        throw new Error('Workflow State row contains an invalid encoded value.');
    }
    return parsed.value;
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
    database: DatabaseSync,
    options?: CreateWorkflowStateStoreOptions,
): WorkflowStateStore {
    database.exec(CREATE_TABLE_SQL);
    const db = drizzle({ client: database });
    const buffer = new Map<WorkflowId, Map<string, WorkflowStatePrimitive>>();
    const flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    const upsert = (
        entries: ReadonlyMap<string, WorkflowStatePrimitive>,
        workflowId: WorkflowId,
    ): void => {
        db.transaction((tx) => {
            for (const [key, value] of entries) {
                const encodedValue = encodeWorkflowStateValue(value);
                tx.insert(workflowStateTable)
                    .values({ workflowId, key, value: encodedValue })
                    .onConflictDoUpdate({
                        target: [workflowStateTable.workflowId, workflowStateTable.key],
                        set: { value: encodedValue },
                    })
                    .run();
            }
        });
    };

    function flushWorkflow(workflowId: WorkflowId): void {
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

    function forWorkflow(workflowId: WorkflowId): WorkflowState {
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

    function listKeys(workflowId: WorkflowId): readonly WorkflowStateEntry[] {
        flushWorkflow(workflowId);
        const rows = db
            .select({ key: workflowStateTable.key, value: workflowStateTable.value })
            .from(workflowStateTable)
            .where(eq(workflowStateTable.workflowId, workflowId))
            .all();
        return rows.map((row) => workflowStateEntry(row.key, decodeWorkflowStateValue(row.value)));
    }

    function setKey(workflowId: WorkflowId, key: string, value: WorkflowStatePrimitive): void {
        const pending = buffer.get(workflowId) ?? new Map<string, WorkflowStatePrimitive>();
        pending.set(key, value);
        buffer.set(workflowId, pending);
        flushWorkflow(workflowId);
    }

    function deleteKey(workflowId: WorkflowId, key: string): void {
        flushWorkflow(workflowId);
        db.delete(workflowStateTable)
            .where(
                and(eq(workflowStateTable.workflowId, workflowId), eq(workflowStateTable.key, key)),
            )
            .run();
    }

    function deleteWorkflow(workflowId: WorkflowId): void {
        buffer.delete(workflowId);
        db.delete(workflowStateTable).where(eq(workflowStateTable.workflowId, workflowId)).run();
    }

    return { forWorkflow, listKeys, setKey, deleteKey, deleteWorkflow, flushAll, dispose };
}

export function createInMemoryWorkflowStateStore(): WorkflowStateStore {
    const buffer = new Map<WorkflowId, Map<string, WorkflowStatePrimitive>>();

    function forWorkflow(workflowId: WorkflowId): WorkflowState {
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

    function listKeys(workflowId: WorkflowId): readonly WorkflowStateEntry[] {
        const pending = buffer.get(workflowId);
        if (!pending) return [];
        return Array.from(pending.entries()).map(([key, value]) => workflowStateEntry(key, value));
    }

    function setKey(workflowId: WorkflowId, key: string, value: WorkflowStatePrimitive): void {
        const pending = buffer.get(workflowId) ?? new Map<string, WorkflowStatePrimitive>();
        pending.set(key, value);
        buffer.set(workflowId, pending);
    }

    function deleteKey(workflowId: WorkflowId, key: string): void {
        const pending = buffer.get(workflowId);
        if (pending) {
            pending.delete(key);
        }
    }

    function deleteWorkflow(workflowId: WorkflowId): void {
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
