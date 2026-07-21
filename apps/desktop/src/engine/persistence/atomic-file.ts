import { randomUUID } from 'node:crypto';
import {
    closeSync,
    constants as fsConstants,
    fsyncSync,
    mkdirSync,
    openSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Either } from 'effect';
import type { PersistenceDiagnostic, PersistencePhase } from '../../shared/persistence.js';

export type AtomicFileDescriptor = number;

export interface AtomicFileSystem {
    readonly makeDirectory: (path: string) => void;
    readonly open: (path: string, flags: number, mode: number) => AtomicFileDescriptor;
    readonly write: (fileDescriptor: AtomicFileDescriptor, contents: string) => void;
    readonly flush: (fileDescriptor: AtomicFileDescriptor) => void;
    readonly close: (fileDescriptor: AtomicFileDescriptor) => void;
    readonly replace: (temporaryPath: string, targetPath: string) => void;
    readonly syncDirectory: (path: string) => void;
    readonly remove: (path: string) => void;
}

export type AtomicWritePhase = Extract<
    PersistencePhase,
    'directory' | 'open' | 'serialize' | 'write' | 'flush' | 'directory_flush' | 'close' | 'replace'
>;

export type AtomicWriteFailure = PersistenceDiagnostic & {
    readonly operation: 'write';
    readonly phase: AtomicWritePhase;
};

export type AtomicWriteResult = Either.Either<void, AtomicWriteFailure>;

export interface AtomicFileWriter {
    readonly write: (
        targetPath: string,
        contents: string,
        options?: { readonly createDirectory?: boolean },
    ) => AtomicWriteResult;
}

const nodeAtomicFileSystem: AtomicFileSystem = {
    makeDirectory: (path) => {
        mkdirSync(path, { recursive: true });
    },
    open: (path, flags, mode) => openSync(path, flags, mode),
    write: (fileDescriptor, contents) => {
        writeFileSync(fileDescriptor, contents, 'utf8');
    },
    flush: (fileDescriptor) => {
        fsyncSync(fileDescriptor);
    },
    close: (fileDescriptor) => {
        closeSync(fileDescriptor);
    },
    replace: (temporaryPath, targetPath) => {
        renameSync(temporaryPath, targetPath);
    },
    syncDirectory: (path) => {
        if (process.platform === 'win32') {
            // Windows does not support fsync on directory handles.
            return;
        }
        const fileDescriptor = openSync(path, fsConstants.O_RDONLY);
        try {
            fsyncSync(fileDescriptor);
        } finally {
            closeSync(fileDescriptor);
        }
    },
    remove: (path) => {
        unlinkSync(path);
    },
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function failure(phase: AtomicWritePhase, targetPath: string, error: unknown): AtomicWriteFailure {
    return {
        kind: 'persistence',
        operation: 'write',
        phase,
        path: targetPath,
        message: errorMessage(error),
    };
}

export function createAtomicWriteFailure(
    targetPath: string,
    phase: AtomicWritePhase,
    error: unknown,
): AtomicWriteFailure {
    return failure(phase, targetPath, error);
}

export function createAtomicFileWriter(
    fileSystem: AtomicFileSystem = nodeAtomicFileSystem,
): AtomicFileWriter {
    return {
        write(targetPath, contents, options): AtomicWriteResult {
            const targetDirectory = dirname(targetPath);
            const temporaryPath = join(
                targetDirectory,
                `.${basename(targetPath)}.${randomUUID()}.tmp`,
            );
            let phase: AtomicWritePhase = options?.createDirectory ? 'directory' : 'open';
            let fileDescriptor: AtomicFileDescriptor | undefined;

            try {
                if (options?.createDirectory) {
                    fileSystem.makeDirectory(targetDirectory);
                }

                phase = 'open';
                fileDescriptor = fileSystem.open(
                    temporaryPath,
                    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
                    0o600,
                );

                phase = 'write';
                fileSystem.write(fileDescriptor, contents);

                phase = 'flush';
                fileSystem.flush(fileDescriptor);

                phase = 'close';
                fileSystem.close(fileDescriptor);
                fileDescriptor = undefined;

                phase = 'replace';
                fileSystem.replace(temporaryPath, targetPath);

                phase = 'directory_flush';
                fileSystem.syncDirectory(targetDirectory);
                return Either.right(undefined);
            } catch (error) {
                if (fileDescriptor !== undefined) {
                    try {
                        fileSystem.close(fileDescriptor);
                    } catch {
                        // Preserve the original failure; cleanup is best effort.
                    }
                }
                try {
                    fileSystem.remove(temporaryPath);
                } catch {
                    // Preserve the original failure; cleanup is best effort.
                }
                return Either.left(failure(phase, targetPath, error));
            }
        },
    };
}

export const atomicFileWriter: AtomicFileWriter = createAtomicFileWriter();
