import { readFileSync } from 'node:fs';
import { Effect, Either } from 'effect';
import type { PersistenceDiagnostic, PersistencePhase } from '../shared/persistence.js';
import {
    type AtomicFileWriter,
    type AtomicWriteResult,
    atomicFileWriter,
    createAtomicWriteFailure,
} from './atomic-file.js';

export type WriteResult = AtomicWriteResult;

function readFailure(
    filePath: string,
    phase: PersistencePhase,
    error: unknown,
): PersistenceDiagnostic {
    return {
        kind: 'persistence',
        operation: 'read',
        phase,
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
    };
}

export function readPropertiesFile(
    filePath: string,
): Effect.Effect<unknown, PersistenceDiagnostic> {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch (error) {
        return Effect.fail(readFailure(filePath, 'open', error));
    }

    try {
        return Effect.succeed(JSON.parse(content));
    } catch (error) {
        return Effect.fail(readFailure(filePath, 'parse', error));
    }
}

export function writePropertiesFile(
    filePath: string,
    properties: Record<string, unknown>,
    writer: AtomicFileWriter = atomicFileWriter,
): WriteResult {
    let contents: string;
    try {
        contents = JSON.stringify(properties, null, 4);
    } catch (error) {
        return Either.left(createAtomicWriteFailure(filePath, 'serialize', error));
    }

    return writer.write(filePath, contents);
}
