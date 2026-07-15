import { type ChildProcess, type ChildProcessByStdio, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

type ElectronProcess = ChildProcessByStdio<null, Readable, Readable>;

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(desktopRoot, 'out');
const rendererRoot = resolve(outputRoot, 'renderer');
const startupMarker = '[main] engine worker ready';
const startupTimeoutMs = 30_000;
const shutdownTimeoutMs = 5_000;

const expectedFiles = [
    'main/index.js',
    'main/worker.js',
    'main/plugin-worker.js',
    'preload/index.cjs',
    'renderer/index.html',
] as const;

const require = createRequire(import.meta.url);

async function assertFile(baseDirectory: string, relativePath: string): Promise<void> {
    const absolutePath = resolve(baseDirectory, relativePath);

    try {
        const file = await stat(absolutePath);
        if (!file.isFile()) {
            throw new Error(`Expected a file but found a different entry: ${relativePath}`);
        }
    } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('Expected a file')) {
            throw error;
        }
        throw new Error(`Missing production artifact: ${relativePath}`, { cause: error });
    }
}

function collectRendererReferences(html: string): readonly string[] {
    const references: string[] = [];
    const attributePattern = /(?:src|href)="([^"]+)"/g;

    for (const match of html.matchAll(attributePattern)) {
        const reference = match[1];
        if (reference?.startsWith('./')) {
            references.push(reference.slice(2).split(/[?#]/, 1)[0] ?? '');
        }
    }

    return references.filter((reference) => reference.length > 0);
}

async function verifyExpectedArtifacts(): Promise<void> {
    for (const relativePath of expectedFiles) {
        await assertFile(outputRoot, relativePath);
        console.log(`PRODUCTION ARTIFACT OK: out/${relativePath}`);
    }

    const rendererHtml = await readFile(resolve(rendererRoot, 'index.html'), 'utf8');
    const rendererReferences = collectRendererReferences(rendererHtml);

    if (rendererReferences.length === 0) {
        throw new Error('Renderer entry does not reference any bundled assets.');
    }

    for (const relativePath of rendererReferences) {
        await assertFile(rendererRoot, relativePath);
        console.log(`PRODUCTION ARTIFACT OK: out/renderer/${relativePath}`);
    }
}

function getElectronExecutable(): string {
    const executable: unknown = require('electron');
    if (typeof executable !== 'string' || executable.length === 0) {
        throw new Error('Electron executable path could not be resolved.');
    }
    return executable;
}

function captureOutput(child: ElectronProcess, onOutput: (output: string) => void): void {
    const capture = (chunk: Buffer): void => {
        const output = chunk.toString();
        process.stdout.write(`[electron] ${output}`);
        onOutput(output);
    };

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
}

function waitForStartup(child: ElectronProcess): Promise<void> {
    return new Promise((resolveStartup, rejectStartup) => {
        let settled = false;
        let output = '';

        const settle = (callback: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            callback();
        };

        const timeout = setTimeout(() => {
            settle(() =>
                rejectStartup(
                    new Error(
                        `Electron did not reach the startup marker within ${startupTimeoutMs / 1000} seconds.\n${output}`,
                    ),
                ),
            );
        }, startupTimeoutMs);

        captureOutput(child, (chunk) => {
            output += chunk;
            if (output.includes(startupMarker)) {
                settle(resolveStartup);
            }
        });

        child.once('error', (error: Error) => {
            settle(() => rejectStartup(new Error('Electron failed to start.', { cause: error })));
        });
        child.once('exit', (code, signal) => {
            settle(() =>
                rejectStartup(
                    new Error(
                        `Electron exited before startup completed (code=${code ?? 'null'}, signal=${signal ?? 'none'}).\n${output}`,
                    ),
                ),
            );
        });
    });
}

function stopProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }

    return new Promise((resolveShutdown) => {
        let settled = false;
        const forceShutdown = setTimeout(() => {
            child.kill('SIGKILL');
            if (!settled) {
                settled = true;
                resolveShutdown();
            }
        }, shutdownTimeoutMs);

        child.once('exit', () => {
            if (!settled) {
                settled = true;
                clearTimeout(forceShutdown);
                resolveShutdown();
            }
        });

        if (!child.kill()) {
            settled = true;
            clearTimeout(forceShutdown);
            resolveShutdown();
        }
    });
}

async function verifyStartup(): Promise<void> {
    const electronExecutable = getElectronExecutable();
    const mainEntry = resolve(outputRoot, 'main/index.js');
    const environment: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
    delete environment.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExecutable, ['--no-sandbox', '--disable-gpu', mainEntry], {
        cwd: desktopRoot,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        await waitForStartup(child);
        console.log('PRODUCTION STARTUP OK: Electron reached the engine-ready marker.');
    } finally {
        await stopProcess(child);
    }
}

async function verifyProductionBuild(): Promise<void> {
    await verifyExpectedArtifacts();
    await verifyStartup();
}

verifyProductionBuild().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PRODUCTION VERIFICATION FAILURE: ${message}`);
    process.exitCode = 1;
});
