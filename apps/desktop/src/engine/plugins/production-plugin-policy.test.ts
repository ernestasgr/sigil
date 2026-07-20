import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
    EngineChannel,
    EngineListPluginsResultSchema,
    EngineReadySchema,
} from '../shared/ipc-channels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerBootstrapPath = resolve(__dirname, 'test-support/engine-worker-bootstrap.mjs');

const EXTERNAL_PLUGIN_HANDLER = `
import { z } from 'zod';
import type { NodeHandler } from '../../node-handlers/types.js';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'external-node' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute({ ctx }) {
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

function writeExternalPlugin(userDataPath: string): void {
    const pluginDir = join(userDataPath, 'plugins', 'external-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
        join(pluginDir, 'plugin.manifest.json'),
        JSON.stringify({
            id: 'com.example.external',
            version: '1.0.0',
            permissions: [],
            emits: ['external.event'],
            nodeType: 'external-node',
        }),
    );
    writeFileSync(join(pluginDir, 'handler.ts'), EXTERNAL_PLUGIN_HANDLER);
}

function waitForReady(worker: Worker): Promise<void> {
    return new Promise((resolveReady, reject) => {
        const onMessage = (raw: unknown): void => {
            if (!EngineReadySchema.safeParse(raw).success) return;
            cleanup();
            resolveReady();
        };
        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const cleanup = (): void => {
            worker.off('message', onMessage);
            worker.off('error', onError);
        };
        worker.on('message', onMessage);
        worker.on('error', onError);
    });
}

function listPlugins(worker: Worker): Promise<readonly string[]> {
    const correlationId = 'production-plugin-policy';
    return new Promise((resolvePlugins, reject) => {
        const onMessage = (raw: unknown): void => {
            const parsed = EngineListPluginsResultSchema.safeParse(raw);
            if (!parsed.success || parsed.data.correlationId !== correlationId) return;
            cleanup();
            resolvePlugins(parsed.data.plugins.map((plugin) => plugin.manifest.id));
        };
        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const cleanup = (): void => {
            worker.off('message', onMessage);
            worker.off('error', onError);
        };
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.postMessage({ type: EngineChannel.ListPlugins, correlationId });
    });
}

describe('production Plugin containment policy', () => {
    let userDataPath: string | undefined;
    let worker: Worker | undefined;

    afterEach(async () => {
        await worker?.terminate();
        if (userDataPath) rmSync(userDataPath, { recursive: true, force: true });
    });

    it('loads source-controlled built-ins without discovering user-writable Plugins', async () => {
        userDataPath = mkdtempSync(join(tmpdir(), 'sigil-production-plugin-policy-'));
        writeExternalPlugin(userDataPath);
        worker = new Worker(workerBootstrapPath, { workerData: { userDataPath } });

        await waitForReady(worker);
        const pluginIds = await listPlugins(worker);

        expect(pluginIds).toEqual(
            expect.arrayContaining(['com.sigil.file-manager', 'com.sigil.file-watcher']),
        );
        expect(pluginIds).not.toContain('com.example.external');
    });
});
