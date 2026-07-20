import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AtomicFileWriter } from './atomic-file.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sigil-props-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

describe('readPropertiesFile', () => {
    it('returns the parsed JSON when the file exists and is valid', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        writeFileSync(
            filePath,
            JSON.stringify({ notifyOnWorkflowError: false, databasePath: '/data/sigil.db' }),
        );

        expect(Effect.runSync(readPropertiesFile(filePath))).toEqual({
            notifyOnWorkflowError: false,
            databasePath: '/data/sigil.db',
        });
    });

    it('returns an error when the file does not exist', () => {
        const filePath = join(tempDir, 'missing.properties.json');

        expect(() => Effect.runSync(readPropertiesFile(filePath))).toThrow();

        const result = Effect.runSync(Effect.either(readPropertiesFile(filePath)));
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toMatchObject({
                operation: 'read',
                phase: 'open',
                path: filePath,
                code: 'ENOENT',
            });
        }
    });

    it('returns an error when the file contains invalid JSON', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        writeFileSync(filePath, '{ not valid json');

        expect(() => Effect.runSync(readPropertiesFile(filePath))).toThrow();

        const result = Effect.runSync(Effect.either(readPropertiesFile(filePath)));
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toMatchObject({
                kind: 'persistence',
                operation: 'read',
                phase: 'parse',
                path: filePath,
            });
        }
    });
});

describe('writePropertiesFile', () => {
    it('writes properties to disk as formatted JSON', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        const result = writePropertiesFile(filePath, {
            notifyOnWorkflowError: false,
            databasePath: '/data/sigil.db',
        });

        expect(Either.isRight(result)).toBe(true);

        const contents = readFileSync(filePath, 'utf-8');
        expect(JSON.parse(contents)).toEqual({
            notifyOnWorkflowError: false,
            databasePath: '/data/sigil.db',
        });
    });

    it('returns Left when the directory does not exist', () => {
        const filePath = join(tempDir, 'missing-dir', 'sigil.properties.json');
        const result = writePropertiesFile(filePath, { notifyOnWorkflowError: true });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toMatchObject({
                kind: 'persistence',
                operation: 'write',
                phase: 'open',
                path: filePath,
            });
        }
    });

    it('returns the replacement failure from its atomic writer', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        const writer: AtomicFileWriter = {
            write: () =>
                Either.left({
                    kind: 'persistence',
                    operation: 'write',
                    phase: 'replace',
                    path: filePath,
                    message: 'replacement denied',
                }),
        };

        const result = writePropertiesFile(filePath, { notifyOnWorkflowError: true }, writer);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.phase).toBe('replace');
            expect(result.left.message).toBe('replacement denied');
        }
    });
});
