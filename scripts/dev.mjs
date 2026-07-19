import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));
const SIGNAL_EXIT_CODES = Object.freeze({
    SIGHUP: 129,
    SIGINT: 130,
    SIGQUIT: 131,
    SIGTERM: 143,
});
const SIGNALS_TO_HANDLE = ['SIGINT', 'SIGTERM'];
const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;
const DEFAULT_KILL_GRACE_PERIOD_MS = 1_000;

function pnpmExecutable(platform) {
    return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function spawnPnpm(args, { cwd, platform, spawnProcess }) {
    const isWindows = platform === 'win32';
    const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : pnpmExecutable(platform);
    const commandArgs = isWindows ? ['/d', '/s', '/c', pnpmExecutable(platform), ...args] : args;

    return spawnProcess(command, commandArgs, {
        cwd,
        detached: !isWindows,
        env: { ...process.env },
        shell: false,
        stdio: 'inherit',
        windowsHide: false,
    });
}

function waitForProcess(child) {
    return new Promise((resolveOutcome) => {
        let settled = false;

        const settle = (outcome) => {
            if (settled) {
                return;
            }

            settled = true;
            resolveOutcome(outcome);
        };

        child.once('error', (error) => {
            settle({ code: null, error, signal: null });
        });
        child.once('close', (code, signal) => {
            settle({ code, error: null, signal });
        });
    });
}

function trackProcess(name, child) {
    const record = {
        child,
        name,
        outcome: undefined,
        running: true,
    };

    record.outcome = waitForProcess(child).then((outcome) => {
        record.running = false;
        return outcome;
    });

    return record;
}

function signalExitCode(signal) {
    return SIGNAL_EXIT_CODES[signal] ?? 1;
}

function outcomeExitCode(outcome) {
    if (typeof outcome.code === 'number' && outcome.code !== 0) {
        return outcome.code;
    }

    if (typeof outcome.signal === 'string') {
        return signalExitCode(outcome.signal);
    }

    return 1;
}

function isSuccessfulBuild(outcome) {
    return outcome.code === 0 && outcome.error === null && outcome.signal === null;
}

function waitForTimeout(timeoutMs) {
    return new Promise((resolveTimeout) => {
        const timeout = setTimeout(resolveTimeout, timeoutMs);
        timeout.unref?.();
    });
}

async function settleWithin(promise, timeoutMs) {
    await Promise.race([promise.catch(() => undefined), waitForTimeout(timeoutMs)]);
}

function isProcessGone(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

function sendToProcessGroup(sendSignal, pid, signal) {
    try {
        sendSignal(-pid, signal);
    } catch (error) {
        if (isProcessGone(error)) {
            return;
        }

        try {
            sendSignal(pid, signal);
        } catch {
            // The process may have exited between the group and direct signal attempts.
        }
    }
}

function defaultExecuteFile(command, args, options) {
    return new Promise((resolveExecution) => {
        execFile(command, args, options, () => {
            resolveExecution();
        });
    });
}

function createProcessTreeTerminator({ executeFile, killGracePeriodMs, platform, sendSignal }) {
    return async (record) => {
        const pid = record.child.pid;
        if (!record.running || !Number.isInteger(pid)) {
            return;
        }

        if (platform === 'win32') {
            await executeFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
            return;
        }

        sendToProcessGroup(sendSignal, pid, 'SIGTERM');
        await settleWithin(record.outcome, killGracePeriodMs);
        if (record.running) {
            sendToProcessGroup(sendSignal, pid, 'SIGKILL');
        }
    };
}

function registerSignalHandlers(signalSource, onSignal) {
    const listeners = new Map();

    for (const signal of SIGNALS_TO_HANDLE) {
        const listener = () => onSignal(signal);
        listeners.set(signal, listener);
        signalSource.on(signal, listener);
    }

    return () => {
        for (const signal of SIGNALS_TO_HANDLE) {
            const listener = listeners.get(signal);
            if (listener === undefined) {
                continue;
            }

            if (typeof signalSource.off === 'function') {
                signalSource.off(signal, listener);
            } else {
                signalSource.removeListener(signal, listener);
            }
        }
    };
}

async function cleanupProcesses(records, terminateProcessTree, timeoutMs) {
    const runningRecords = records.filter((record) => record.running);

    await Promise.all(
        runningRecords.map((record) =>
            settleWithin(
                Promise.resolve().then(() => terminateProcessTree(record)),
                timeoutMs,
            ),
        ),
    );
    await Promise.all(runningRecords.map((record) => settleWithin(record.outcome, timeoutMs)));
}

function processEvent(record) {
    return record.outcome.then((outcome) => ({ outcome, type: 'process' }));
}

function signalEvent(signalPromise) {
    return signalPromise.then((signal) => ({ signal, type: 'signal' }));
}

export async function runDevelopment(options = {}) {
    const {
        cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
        cwd = ROOT_DIRECTORY,
        executeFile = defaultExecuteFile,
        killGracePeriodMs = DEFAULT_KILL_GRACE_PERIOD_MS,
        platform = process.platform,
        sendSignal = (pid, signal) => process.kill(pid, signal),
        signalSource = process,
        spawnProcess = spawn,
        terminateProcessTree = createProcessTreeTerminator({
            executeFile,
            killGracePeriodMs,
            platform,
            sendSignal,
        }),
    } = options;

    const records = [];
    let receivedSignal;
    let resolveSignal;
    const signalPromise = new Promise((resolveSignalEvent) => {
        resolveSignal = resolveSignalEvent;
    });
    const onSignal = (signal) => {
        if (receivedSignal === undefined) {
            receivedSignal = signal;
            resolveSignal(signal);
        }
    };
    let removeSignalHandlers = () => undefined;

    const startProcess = (name, args) => {
        const record = trackProcess(name, spawnPnpm(args, { cwd, platform, spawnProcess }));
        records.push(record);
        return record;
    };

    try {
        removeSignalHandlers = registerSignalHandlers(signalSource, onSignal);

        const schemaBuild = startProcess('schema-build', ['--filter', '@sigil/schema', 'build']);
        const buildEvent = await Promise.race([
            processEvent(schemaBuild),
            signalEvent(signalPromise),
        ]);

        if (buildEvent.type === 'signal') {
            return signalExitCode(buildEvent.signal);
        }

        if (!isSuccessfulBuild(buildEvent.outcome)) {
            return outcomeExitCode(buildEvent.outcome);
        }

        const schemaWatcher = startProcess('schema', ['--filter', '@sigil/schema', 'dev']);
        const desktopWatcher = startProcess('desktop', ['--filter', '@sigil/desktop', 'dev']);
        const watcherEvent = await Promise.race([
            processEvent(schemaWatcher),
            processEvent(desktopWatcher),
            signalEvent(signalPromise),
        ]);

        if (watcherEvent.type === 'signal') {
            return signalExitCode(watcherEvent.signal);
        }

        return outcomeExitCode(watcherEvent.outcome);
    } catch (error) {
        if (receivedSignal !== undefined) {
            return signalExitCode(receivedSignal);
        }

        console.error('[dev] Failed to start the development processes.', error);
        return 1;
    } finally {
        removeSignalHandlers();
        await cleanupProcesses(records, terminateProcessTree, cleanupTimeoutMs);
    }
}

const isMainModule =
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
    process.exitCode = await runDevelopment();
}
