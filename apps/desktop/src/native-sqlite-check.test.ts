import { describe, expect, it } from 'vitest';

import { checkNativeSqlite, type NativeSqliteFactory } from './native-sqlite-check.js';

describe('checkNativeSqlite', () => {
    it('opens an in-memory database, executes a query, and closes it', async () => {
        const calls: string[] = [];
        const factory: NativeSqliteFactory = (filename) => {
            calls.push(`open:${filename}`);

            return {
                prepare: (sql) => ({
                    get: () => {
                        calls.push(`query:${sql}`);
                        return 1;
                    },
                }),
                close: () => {
                    calls.push('close');
                },
            };
        };

        const result = await checkNativeSqlite(async () => factory);

        expect(result).toEqual({ ok: true });
        expect(calls).toEqual(['open::memory:', 'query:SELECT 1', 'close']);
    });

    it('returns actionable guidance when the native binding cannot load', async () => {
        const result = await checkNativeSqlite(async () => {
            throw new Error('Could not locate the bindings file');
        });

        expect(result.ok).toBe(false);

        if (result.ok) {
            return;
        }

        expect(result.message).toContain('Native SQLite preflight failed');
        expect(result.message).toContain('Visual Studio 2022 Build Tools');
        expect(result.message).toContain('Python 3');
        expect(result.message).toContain('pnpm setup:native');
        expect(result.message).toContain('pnpm test:native');
    });
});
