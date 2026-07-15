import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test as base, expect } from '@playwright/test';
import {
    ElectronEngineStartupFailureError,
    ElectronEngineStartupTimeoutError,
} from '../../src/main/engine-startup-diagnostics.js';
import {
    createIsolatedTestWorkspace,
    type IsolatedTestWorkspace,
    launchElectron,
    type RunningElectronApplication,
    writeApplicationLog,
} from './electron-harness.js';

type ElectronFixtures = {
    readonly electron: RunningElectronApplication;
    readonly workspace: IsolatedTestWorkspace;
};

function errorLog(error: unknown): string {
    if (
        error instanceof ElectronEngineStartupFailureError ||
        error instanceof ElectronEngineStartupTimeoutError
    ) {
        return `${error.name}: ${error.message}\n`;
    }
    return `${error instanceof Error ? error.name : 'UnknownError'}: ${error instanceof Error ? error.message : String(error)}\n`;
}

export const test = base.extend<ElectronFixtures>({
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the fixture dependency object.
    workspace: async ({}, use) => {
        const workspace = await createIsolatedTestWorkspace();
        try {
            await use(workspace);
        } finally {
            await workspace.cleanup();
        }
    },
    electron: async ({ workspace }, use, testInfo) => {
        let running: RunningElectronApplication | undefined;
        let fixtureError: unknown;
        let tracingStarted = false;

        try {
            running = await launchElectron({ workspace });
            await running.application.context().tracing.start({
                screenshots: true,
                snapshots: true,
                sources: true,
            });
            tracingStarted = true;
            await use(running);
        } catch (error) {
            fixtureError = error;
            throw error;
        } finally {
            const failed =
                fixtureError !== undefined || testInfo.status !== testInfo.expectedStatus;
            if (running && failed) {
                await running.window
                    .screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true })
                    .catch(() => undefined);
            }

            if (tracingStarted) {
                await running?.application
                    .context()
                    .tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : undefined)
                    .catch(() => undefined);
            }

            const log = running?.applicationLog() ?? errorLog(fixtureError);
            if (failed) {
                await mkdir(dirname(testInfo.outputPath('electron.log')), { recursive: true });
                await writeApplicationLog(testInfo.outputPath('electron.log'), log);
            }

            await running?.close();
        }
    },
});

export { expect };
