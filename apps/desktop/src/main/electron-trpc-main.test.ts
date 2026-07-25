import { describe, expect, it } from 'vitest';

import { electronTrpcMain } from './electron-trpc-main.js';

describe('electron-trpc main loader', () => {
    it('loads the CommonJS entrypoint required by Electron main ESM', () => {
        expect(electronTrpcMain.createIPCHandler).toEqual(expect.any(Function));
        expect(electronTrpcMain.exposeElectronTRPC).toEqual(expect.any(Function));
    });
});
