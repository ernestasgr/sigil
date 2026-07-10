import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Either } from 'effect';

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
    });

    it('returns an error when the file contains invalid JSON', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        writeFileSync(filePath, '{ not valid json');

        expect(() => Effect.runSync(readPropertiesFile(filePath))).toThrow();
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
            expect(result.left).toBeTruthy();
        }
    });
});
