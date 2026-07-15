import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RendererChannel } from '../shared/ipc-channels.js';
import type { IpcHandlerContext } from './ipc-handlers.js';
import { registerIpcHandlers } from './ipc-handlers.js';
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
});
