import { readFileSync, writeFileSync } from 'node:fs';
import { Effect, Either } from 'effect';

export type WriteResult = Either.Either<void, string>;

export function readPropertiesFile(filePath: string): Effect.Effect<unknown, unknown> {
    return Effect.try(() => {
        const content = readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    });
}

export function writePropertiesFile(
    filePath: string,
    properties: Record<string, unknown>,
): WriteResult {
    return Effect.try(() => {
        writeFileSync(filePath, JSON.stringify(properties, null, 4), 'utf-8');
    }).pipe(
        Effect.mapError((errVal) => (errVal instanceof Error ? errVal.message : String(errVal))),
        Effect.either,
        Effect.runSync,
    );
}
