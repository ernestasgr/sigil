import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RendererChannel } from '../shared/ipc-channels.js';
import type { PermissionOverrideOutcome } from '../shared/persistence.js';
import type { EngineHandle } from './engine-client.js';
import type { IpcHandlerContext } from './ipc/ipc-handlers.js';
import { registerIpcHandlers } from './ipc/ipc-handlers.js';
import type { NativeDialogAdapter } from './native-dialog.js';

type RegisteredHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockHandle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
    ipcMain: {
        handle: mockHandle,
    },
    dialog: {
        showOpenDialog: vi.fn(),
    },
}));

describe('registerIpcHandlers native dialog seam', () => {
    const handlers = new Map<string, RegisteredHandler>();
    let temporaryDirectory: string | undefined;

    beforeEach(() => {
        handlers.clear();
        mockHandle.mockReset();
        mockHandle.mockImplementation((channel: string, handler: RegisteredHandler): void => {
            handlers.set(channel, handler);
        });
    });

    afterEach(async () => {
        if (temporaryDirectory) {
            await rm(temporaryDirectory, { recursive: true, force: true });
            temporaryDirectory = undefined;
        }
    });

    it('uses the injected dialog fake to return selected file metadata', async () => {
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'sigil-dialog-test-'));
        const selectedPath = join(temporaryDirectory, 'fixture.txt');
        await writeFile(selectedPath, 'native dialog fixture', 'utf8');

        const nativeDialog: NativeDialogAdapter = {
            showOpenFileDialog: vi.fn().mockResolvedValue({
                canceled: false,
                filePaths: [selectedPath],
            }),
        };
        const mainWindow = {} as unknown as BrowserWindow;
        const context: IpcHandlerContext = {
            getEngine: () => null,
            getMainWindow: () => mainWindow,
            onRendererReady: () => undefined,
            nativeDialog,
        };

        registerIpcHandlers(context);

        const handler = handlers.get(RendererChannel.OpenFileDialog);
        expect(handler).toBeDefined();
        await expect(handler?.({})).resolves.toEqual({
            path: selectedPath,
            name: 'fixture.txt',
            ext: 'txt',
            size: Buffer.byteLength('native dialog fixture'),
            dir: temporaryDirectory,
        });
        expect(nativeDialog.showOpenFileDialog).toHaveBeenCalledWith(mainWindow);
    });

    it.each([
        {
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId: 'plugin-ghost',
            error: 'Plugin "plugin-ghost" is not registered in the Manifest Registry.',
        },
        {
            ok: false,
            kind: 'persistence',
            error: 'replacement denied',
            diagnostic: {
                kind: 'persistence',
                operation: 'write',
                phase: 'replace',
                path: 'C:/permission-overrides.json',
                message: 'replacement denied',
            },
        },
    ] as const satisfies readonly PermissionOverrideOutcome[])(
        'passes through the $kind permission override outcome without reshaping it',
        async (outcome) => {
            const engine = {
                setPermissionOverride: vi.fn().mockResolvedValue(outcome),
            } as unknown as EngineHandle;
            const context: IpcHandlerContext = {
                getEngine: () => engine,
                getMainWindow: () => null,
                onRendererReady: () => undefined,
            };

            registerIpcHandlers(context);

            const handler = handlers.get(RendererChannel.SetPermissionOverride);
            expect(handler).toBeDefined();
            const response = await handler?.({}, 'plugin-ghost', []);

            expect(response).toEqual(outcome);
            expect(engine.setPermissionOverride).toHaveBeenCalledWith({
                pluginId: 'plugin-ghost',
                overrides: [],
            });
        },
    );
});
