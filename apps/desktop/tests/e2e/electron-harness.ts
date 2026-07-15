import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { type ElectronApplication, _electron as electron } from 'playwright';
import {
    ElectronEngineStartupFailureError,
    ElectronEngineStartupTimeoutError,
    waitForEngineReady,
} from '../../src/main/engine-startup-diagnostics.js';

export const DEFAULT_ENGINE_STARTUP_TIMEOUT_MS = 30_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface ElectronLaunchLayout {
    readonly desktopRoot: string;
    readonly productionEntry: string;
    readonly electronExecutable: string;
}

export function resolveElectronLaunchLayout(): ElectronLaunchLayout {
    const desktopRoot = resolve(__dirname, '../..');
    const productionEntry = resolve(
        desktopRoot,
        process.env.SIGIL_ELECTRON_ENTRY ?? 'out/main/index.js',
    );
    const electronExecutable = process.env.SIGIL_ELECTRON_EXECUTABLE ?? resolveElectronExecutable();
    return { desktopRoot, productionEntry, electronExecutable };
}

function resolveElectronExecutable(): string {
    const executable: unknown = require('electron');
    if (typeof executable !== 'string' || executable.length === 0) {
        throw new Error(
            'Electron executable path could not be resolved. Install the desktop dependencies first.',
        );
    }
    return executable;
}

interface OutputBuffer {
    readonly append: (source: string, chunk: Buffer | string) => void;
    readonly subscribe: (listener: (output: string) => void) => () => void;
    readonly text: () => string;
}

function createOutputBuffer(): OutputBuffer {
    const chunks: string[] = [];
    const listeners = new Set<(output: string) => void>();

    return {
        append(source, chunk): void {
            const output = `[${source}] ${chunk.toString()}`;
            chunks.push(output);
            const text = chunks.join('');
            for (const listener of [...listeners]) listener(text);
        },
        subscribe(listener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        text: () => chunks.join(''),
    };
}

function attachProcessOutput(process: ChildProcess, output: OutputBuffer): void {
    process.stdout?.on('data', (chunk: Buffer | string) => output.append('stdout', chunk));
    process.stderr?.on('data', (chunk: Buffer | string) => output.append('stderr', chunk));
}

export interface IsolatedTestWorkspace {
    readonly rootDirectory: string;
    readonly userDataDirectory: string;
    readonly workspaceDirectory: string;
    readonly cleanup: () => Promise<void>;
}

export async function createIsolatedTestWorkspace(): Promise<IsolatedTestWorkspace> {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'sigil-electron-e2e-'));
    const userDataDirectory = join(rootDirectory, 'user-data');
    const workspaceDirectory = join(rootDirectory, 'workspace');
    await Promise.all([mkdir(userDataDirectory), mkdir(workspaceDirectory)]);

    return {
        rootDirectory,
        userDataDirectory,
        workspaceDirectory,
        cleanup: () => rm(rootDirectory, { recursive: true, force: true }),
    };
}

export interface RunningElectronApplication {
    readonly application: ElectronApplication;
    readonly window: Page;
    readonly applicationLog: () => string;
    readonly close: () => Promise<void>;
}

export interface LaunchElectronOptions {
    readonly workspace: IsolatedTestWorkspace;
    readonly startupTimeoutMs?: number;
}

function launchEnvironment(): { [key: string]: string } {
    const environment: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) environment[key] = value;
    }
    delete environment.ELECTRON_RUN_AS_NODE;
    environment.CI = 'true';
    environment.SIGIL_E2E = 'true';
    return environment;
}

async function assertProductionEntry(entry: string): Promise<void> {
    try {
        const entryStat = await stat(entry);
        if (!entryStat.isFile()) throw new Error('not a file');
    } catch {
        throw new ElectronEngineStartupFailureError(
            `The production Electron entry is missing: ${entry}. Run pnpm build before the smoke test.`,
            '',
        );
    }
}

async function closeQuietly(application: ElectronApplication): Promise<void> {
    try {
        await application.close();
    } catch {
        const process = application.process();
        if (process.exitCode === null && process.signalCode === null) process.kill();
    }
}

export async function launchElectron(
    options: LaunchElectronOptions,
): Promise<RunningElectronApplication> {
    const layout = resolveElectronLaunchLayout();
    await assertProductionEntry(layout.productionEntry);

    let application: ElectronApplication;
    try {
        application = await electron.launch({
            args: [
                '--no-sandbox',
                '--disable-gpu',
                `--user-data-dir=${options.workspace.userDataDirectory}`,
                layout.productionEntry,
            ],
            cwd: options.workspace.workspaceDirectory,
            env: launchEnvironment(),
            executablePath: layout.electronExecutable,
            timeout: options.startupTimeoutMs ?? DEFAULT_ENGINE_STARTUP_TIMEOUT_MS,
        });
    } catch (error) {
        throw new ElectronEngineStartupFailureError(
            `Playwright could not launch Electron: ${error instanceof Error ? error.message : String(error)}`,
            '',
        );
    }

    const output = createOutputBuffer();
    const process = application.process();
    attachProcessOutput(process, output);
    application.on('console', (message) => {
        output.append(`electron-console:${message.type()}`, message.text());
    });

    try {
        await waitForEngineReady(
            process,
            output,
            options.startupTimeoutMs ?? DEFAULT_ENGINE_STARTUP_TIMEOUT_MS,
        );
        const window = await application.firstWindow({
            timeout: options.startupTimeoutMs ?? DEFAULT_ENGINE_STARTUP_TIMEOUT_MS,
        });
        window.on('console', (message) => {
            output.append(`renderer-console:${message.type()}`, message.text());
        });
        window.on('pageerror', (error) => {
            output.append('renderer-pageerror', error.message);
        });

        return {
            application,
            window,
            applicationLog: output.text,
            close: () => closeQuietly(application),
        };
    } catch (error) {
        await closeQuietly(application);
        if (
            error instanceof ElectronEngineStartupFailureError ||
            error instanceof ElectronEngineStartupTimeoutError
        ) {
            throw error;
        }
        throw new ElectronEngineStartupFailureError(
            `Electron opened but its first window could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            output.text(),
        );
    }
}

export async function writeApplicationLog(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        path,
        contents.length > 0 ? contents : '[no application output captured]\n',
        'utf8',
    );
}
