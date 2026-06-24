import type { Database } from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    readonly get: (key: string) => string | undefined;
    readonly set: (key: string, value: string) => void;
    readonly flush: () => void;
}

export interface WorkflowStateStore {
    readonly forWorkflow: (workflowId: string) => WorkflowState;
    readonly flushAll: () => void;
    readonly dispose: () => void;
}

export interface CreateWorkflowStateStoreOptions {
    readonly flushIntervalMs?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 250;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workflow_state (
    workflow_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workflow_id, key)
);
`;

export function createWorkflowStateStore(
    database: Database,
    options?: CreateWorkflowStateStoreOptions,
): WorkflowStateStore {
    database.exec(CREATE_TABLE_SQL);
    const db = drizzle(database);
    const buffer = new Map<string, Map<string, string>>();
    const flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    const upsert = database.transaction(
        (entries: ReadonlyMap<string, string>, workflowId: string) => {
            for (const [key, value] of entries) {
                db.insert(workflowStateTable)
                    .values({ workflowId, key, value })
                    .onConflictDoUpdate({
                        target: [workflowStateTable.workflowId, workflowStateTable.key],
                        set: { value },
                    })
                    .run();
            }
        },
    );

    function flushWorkflow(workflowId: string): void {
        const entries = buffer.get(workflowId);
        if (!entries || entries.size === 0) return;
        buffer.delete(workflowId);
        upsert(entries, workflowId);
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
            get(key: string): string | undefined {
                const pending = buffer.get(workflowId);
                if (pending?.has(key)) return pending.get(key);
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
                return row?.value;
            },
            set(key: string, value: string): void {
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

    return { forWorkflow, flushAll, dispose };
}

export function createInMemoryWorkflowStateStore(): WorkflowStateStore {
    const buffer = new Map<string, Map<string, string>>();

    function forWorkflow(workflowId: string): WorkflowState {
        let pending = buffer.get(workflowId);
        if (!pending) {
            pending = new Map<string, string>();
            buffer.set(workflowId, pending);
        }
        const pendingMap = pending;
        return {
            get: (key: string): string | undefined => pendingMap.get(key),
            set: (key: string, value: string): void => {
                pendingMap.set(key, value);
            },
            flush: (): void => {},
        };
    }

    return { forWorkflow, flushAll: (): void => {}, dispose: (): void => {} };
}
