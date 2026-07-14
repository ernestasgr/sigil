export interface NativeSqliteStatement {
    readonly get: () => unknown;
}

export interface NativeSqliteDatabase {
    readonly prepare: (sql: string) => NativeSqliteStatement;
    readonly close: () => void;
}

export type NativeSqliteFactory = (filename: string) => NativeSqliteDatabase;
export type NativeSqliteLoader = () => Promise<NativeSqliteFactory>;

export type NativeSqliteCheckResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string };

export function formatNativeSqliteError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);

    return [
        'Native SQLite preflight failed: better-sqlite3 could not load or execute.',
        `Underlying error: ${detail}`,
        'Install the Windows native prerequisites before rebuilding or testing:',
        '  - Visual Studio 2022 Build Tools with the Desktop development with C++ workload, MSVC v143, and a Windows 10/11 SDK.',
        '  - Python 3 available on PATH for node-gyp.',
        'Then, from the repository root, run:',
        '  pnpm install',
        '  pnpm setup:native',
        '  pnpm test:native',
    ].join('\n');
}

async function loadNativeSqlite(): Promise<NativeSqliteFactory> {
    const { default: Database } = await import('better-sqlite3');

    return (filename: string): NativeSqliteDatabase => new Database(filename);
}

export async function checkNativeSqlite(
    loadDatabase: NativeSqliteLoader = loadNativeSqlite,
): Promise<NativeSqliteCheckResult> {
    try {
        const createDatabase = await loadDatabase();
        const database = createDatabase(':memory:');

        try {
            database.prepare('SELECT 1').get();
        } finally {
            database.close();
        }

        return { ok: true };
    } catch (error: unknown) {
        return { ok: false, message: formatNativeSqliteError(error) };
    }
}
