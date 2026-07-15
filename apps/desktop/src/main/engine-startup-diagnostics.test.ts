import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
    ElectronEngineStartupFailureError,
    ElectronEngineStartupTimeoutError,
    ENGINE_READY_MARKER,
    type EngineStartupOutput,
    observeEngineStartup,
    waitForEngineReady,
} from './engine-startup-diagnostics.js';

type TestOutput = EngineStartupOutput & { readonly emit: (chunk: string) => void };

function createTestOutput(initial = ''): TestOutput {
    let current = initial;
    const listeners = new Set<(output: string) => void>();
    return {
        subscribe(listener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        text: () => current,
        emit(chunk): void {
            current += chunk;
            for (const listener of [...listeners]) listener(current);
        },
    };
}

function createTestProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
    }) as unknown as ChildProcess;
}

describe('Electron startup diagnostics', () => {
    it('recognizes the engine readiness marker', () => {
        expect(observeEngineStartup(`boot\n${ENGINE_READY_MARKER}\n`)).toEqual({ kind: 'ready' });
    });

    it('classifies an engine worker failure separately from a timeout', () => {
        const failure = new ElectronEngineStartupFailureError(
            '[engine] worker error: native binding failed',
            '[stderr] [engine] worker error: native binding failed',
        );
        const timeout = new ElectronEngineStartupTimeoutError(250, '[stdout] still booting');

        expect(failure.kind).toBe('engine-startup-failure');
        expect(timeout.kind).toBe('engine-startup-timeout');
        expect(failure.message).toContain('native binding failed');
        expect(timeout.message).toContain('250ms');
    });

    it('resolves immediately when the marker is already in the buffered output', async () => {
        const process = createTestProcess();
        const output = createTestOutput(ENGINE_READY_MARKER);

        await expect(waitForEngineReady(process, output, 1_000)).resolves.toBeUndefined();
    });

    it('rejects immediately when the process already exited before the call', async () => {
        const process = Object.assign(createTestProcess(), { exitCode: 1, signalCode: null });
        const output = createTestOutput();

        await expect(waitForEngineReady(process, output, 1_000)).rejects.toMatchObject({
            kind: 'engine-startup-failure',
        });
    });

    it('rejects worker output as a startup failure', async () => {
        const process = createTestProcess();
        const output = createTestOutput();
        const ready = waitForEngineReady(process, output, 1_000);

        output.emit('[engine] worker error: native binding failed');

        await expect(ready).rejects.toMatchObject({
            kind: 'engine-startup-failure',
        });
    });

    it('resolves when the engine readiness marker arrives', async () => {
        const process = createTestProcess();
        const output = createTestOutput();
        const ready = waitForEngineReady(process, output, 1_000);

        output.emit(ENGINE_READY_MARKER);

        await expect(ready).resolves.toBeUndefined();
    });

    it('classifies a live process without readiness as a timeout', async () => {
        const process = createTestProcess();
        const output = createTestOutput();

        await expect(waitForEngineReady(process, output, 20)).rejects.toMatchObject({
            kind: 'engine-startup-timeout',
            timeoutMs: 20,
        });
    });

    it('classifies an early process exit as a startup failure', async () => {
        const process = createTestProcess();
        const output = createTestOutput();
        const ready = waitForEngineReady(process, output, 1_000);

        process.emit('exit', 1, null);

        await expect(ready).rejects.toMatchObject({
            kind: 'engine-startup-failure',
        });
    });
});
