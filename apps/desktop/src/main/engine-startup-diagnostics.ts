import type { ChildProcess } from 'node:child_process';

export const ENGINE_READY_MARKER = '[main] engine worker ready';

const ENGINE_FAILURE_PATTERNS: readonly RegExp[] = [
    /\[engine\] worker error:/,
    /\[engine\] worker exited with code/,
];

export type EngineStartupObservation =
    | { readonly kind: 'ready' }
    | { readonly kind: 'failure'; readonly reason: string }
    | { readonly kind: 'waiting' };

export interface EngineStartupOutput {
    readonly subscribe: (listener: (output: string) => void) => () => void;
    readonly text: () => string;
}

export class ElectronEngineStartupFailureError extends Error {
    readonly kind = 'engine-startup-failure' as const;
    readonly output: string;

    constructor(reason: string, output: string) {
        super(
            `Electron engine startup failed before the readiness signal. ${reason}\n` +
                'Check the application log below for the failing worker or build path.\n' +
                output,
        );
        this.name = 'ElectronEngineStartupFailureError';
        this.output = output;
    }
}

export class ElectronEngineStartupTimeoutError extends Error {
    readonly kind = 'engine-startup-timeout' as const;
    readonly output: string;
    readonly timeoutMs: number;

    constructor(timeoutMs: number, output: string) {
        super(
            `Electron engine startup timed out after ${timeoutMs}ms without the readiness signal ` +
                `(${ENGINE_READY_MARKER}). Verify the production build and engine worker launch path.\n` +
                output,
        );
        this.name = 'ElectronEngineStartupTimeoutError';
        this.output = output;
        this.timeoutMs = timeoutMs;
    }
}

export function observeEngineStartup(output: string): EngineStartupObservation {
    if (output.includes(ENGINE_READY_MARKER)) return { kind: 'ready' };

    for (const pattern of ENGINE_FAILURE_PATTERNS) {
        const match = output.match(pattern);
        if (match?.[0]) return { kind: 'failure', reason: match[0] };
    }

    return { kind: 'waiting' };
}

export function waitForEngineReady(
    process: ChildProcess,
    output: EngineStartupOutput,
    timeoutMs: number,
): Promise<void> {
    const initialObservation = observeEngineStartup(output.text());
    if (initialObservation.kind === 'ready') return Promise.resolve();
    if (initialObservation.kind === 'failure') {
        return Promise.reject(
            new ElectronEngineStartupFailureError(initialObservation.reason, output.text()),
        );
    }
    if (process.exitCode !== null || process.signalCode !== null) {
        return Promise.reject(
            new ElectronEngineStartupFailureError(
                `The Electron process exited before readiness (code=${process.exitCode ?? 'null'}, signal=${process.signalCode ?? 'none'}).`,
                output.text(),
            ),
        );
    }

    return new Promise<void>((resolveReady, rejectReady) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;

        const cleanup = (): void => {
            if (timer) clearTimeout(timer);
            unsubscribeOutput();
            process.removeListener('error', onError);
            process.removeListener('exit', onExit);
        };

        const settle = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };

        const onOutput = (): void => {
            const observation = observeEngineStartup(output.text());
            if (observation.kind === 'ready') {
                settle(resolveReady);
                return;
            }
            if (observation.kind === 'failure') {
                settle(() =>
                    rejectReady(
                        new ElectronEngineStartupFailureError(observation.reason, output.text()),
                    ),
                );
            }
        };

        const onError = (error: Error): void => {
            settle(() =>
                rejectReady(
                    new ElectronEngineStartupFailureError(
                        `The Electron process reported an error: ${error.message}`,
                        output.text(),
                    ),
                ),
            );
        };

        const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
            settle(() =>
                rejectReady(
                    new ElectronEngineStartupFailureError(
                        `The Electron process exited before readiness (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`,
                        output.text(),
                    ),
                ),
            );
        };

        const unsubscribeOutput = output.subscribe(onOutput);
        process.once('error', onError);
        process.once('exit', onExit);
        timer = setTimeout(() => {
            settle(() =>
                rejectReady(new ElectronEngineStartupTimeoutError(timeoutMs, output.text())),
            );
        }, timeoutMs);
        onOutput();
    });
}
