import { readFileSync } from 'node:fs';

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
