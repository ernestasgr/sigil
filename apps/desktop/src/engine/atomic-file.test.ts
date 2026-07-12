import { dirname, win32 } from 'node:path';
import { Either } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { type AtomicFileSystem, createAtomicFileWriter } from './atomic-file.js';

function fakeFileSystem(overrides: Partial<AtomicFileSystem> = {}): AtomicFileSystem {
    return {
        makeDirectory: vi.fn(),
        open: vi.fn(() => 7),
        write: vi.fn(),
        flush: vi.fn(),
        close: vi.fn(),
        replace: vi.fn(),
        syncDirectory: vi.fn(),
        remove: vi.fn(),
        ...overrides,
    };
}

describe('createAtomicFileWriter', () => {
    it('writes a temporary file and replaces the target in the target directory', () => {
        const fileSystem = fakeFileSystem();
        const writer = createAtomicFileWriter(fileSystem);

        const result = writer.write('C:/work/properties.json', '{"ok":true}', {
            createDirectory: true,
        });

        expect(Either.isRight(result)).toBe(true);
        expect(fileSystem.makeDirectory).toHaveBeenCalledWith('C:/work');
        const temporaryPath = vi.mocked(fileSystem.open).mock.calls[0]?.[0];
        expect(temporaryPath).toBeDefined();
        expect(win32.normalize(dirname(temporaryPath ?? ''))).toBe(win32.normalize('C:/work'));
        expect(temporaryPath).not.toBe('C:/work/properties.json');
        expect(fileSystem.replace).toHaveBeenCalledWith(temporaryPath, 'C:/work/properties.json');
        expect(fileSystem.syncDirectory).toHaveBeenCalledWith('C:/work');
        expect(fileSystem.remove).not.toHaveBeenCalled();
    });

    it('returns a structured write failure and cleans up the temporary file', () => {
        const fileSystem = fakeFileSystem({
            write: vi.fn(() => {
                throw new Error('disk full');
            }),
        });
        const writer = createAtomicFileWriter(fileSystem);

        const result = writer.write('C:/work/properties.json', '{}');

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toEqual({
                kind: 'persistence',
                operation: 'write',
                phase: 'write',
                path: 'C:/work/properties.json',
                message: 'disk full',
            });
        }
        const temporaryPath = vi.mocked(fileSystem.open).mock.calls[0]?.[0];
        expect(fileSystem.remove).toHaveBeenCalledWith(temporaryPath);
        expect(fileSystem.replace).not.toHaveBeenCalled();
    });

    it('returns a replacement failure without reporting success', () => {
        const fileSystem = fakeFileSystem({
            replace: vi.fn(() => {
                throw new Error('replacement denied');
            }),
        });
        const writer = createAtomicFileWriter(fileSystem);

        const result = writer.write('C:/work/properties.json', '{}');

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.phase).toBe('replace');
            expect(result.left.message).toBe('replacement denied');
        }
        expect(fileSystem.remove).toHaveBeenCalled();
    });

    it('returns a directory flush failure after replacement without reporting success', () => {
        const fileSystem = fakeFileSystem({
            syncDirectory: vi.fn(() => {
                throw new Error('directory flush denied');
            }),
        });
        const writer = createAtomicFileWriter(fileSystem);

        const result = writer.write('C:/work/properties.json', '{}');

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.phase).toBe('directory_flush');
            expect(result.left.message).toBe('directory flush denied');
        }
        expect(fileSystem.replace).toHaveBeenCalled();
        expect(fileSystem.remove).toHaveBeenCalled();
    });
});
