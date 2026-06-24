import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPropertiesFile } from './properties-loader.js';

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

        expect(readPropertiesFile(filePath)).toEqual({
            notifyOnWorkflowError: false,
            databasePath: '/data/sigil.db',
        });
    });

    it('returns an empty object when the file does not exist', () => {
        const filePath = join(tempDir, 'missing.properties.json');

        expect(readPropertiesFile(filePath)).toEqual({});
    });

    it('returns an empty object when the file contains invalid JSON', () => {
        const filePath = join(tempDir, 'sigil.properties.json');
        writeFileSync(filePath, '{ not valid json');

        expect(readPropertiesFile(filePath)).toEqual({});
    });
});
