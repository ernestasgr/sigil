import { readFileSync, writeFileSync } from 'node:fs';

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function readPropertiesFile(filePath: string): unknown {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return {};
    }
    try {
        return JSON.parse(content);
    } catch {
        return {};
    }
}

export function writePropertiesFile(
    filePath: string,
    properties: Record<string, unknown>,
): WriteResult {
    try {
        writeFileSync(filePath, JSON.stringify(properties, null, 4), 'utf-8');
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
