import { createRequire } from 'node:module';

type ElectronTrpcMain = typeof import('electron-trpc/main');

const requireFromMain = createRequire(import.meta.url);

export const electronTrpcMain = requireFromMain('electron-trpc/main') as ElectronTrpcMain;
