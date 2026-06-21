import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';
import { spawnEngine, type EngineHandle } from './engine-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RENDERER_DIST = resolvePath(__dirname, '../renderer');
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];

let engine: EngineHandle | null = null;

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        title: 'Sigil',
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0E0C10',
        webPreferences: {
            preload: resolvePath(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    window.webContents.openDevTools();

    if (RENDERER_DEV_URL) {
        void window.loadURL(RENDERER_DEV_URL);
    } else {
        void window.loadFile(resolvePath(RENDERER_DIST, 'index.html'));
    }

    window.once('ready-to-show', () => {
        window.show();
    });

    window.webContents.on('console-message', (event) => {
        const { level, message, lineNumber, sourceId } = event;

        console.log(`[renderer ${level}] ${message} (${sourceId}:${lineNumber})`);
    });

    return window;
}

function wireEngineIpc(): void {
    ipcMain.handle(RendererChannel.EnginePong, async (): Promise<EnginePong | null> => {
        if (!engine) return null;
        try {
            return await engine.ping();
        } catch (err) {
            console.error('[main] engine ping failed:', err);
            return null;
        }
    });
}

app.whenReady().then(() => {
    engine = spawnEngine();

    engine.onReady(() => {
        console.log('[main] engine worker ready');
    });

    wireEngineIpc();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    if (engine) {
        await engine.terminate();
        engine = null;
    }
});
