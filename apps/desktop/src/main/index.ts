import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePipeline, type CompiledPipeline } from '@sigil/schema';

import { RendererChannel, type EnginePong } from '../shared/ipc-channels.js';
import type { NodePosition, WorkflowSummary } from '../shared/workflow.js';
import { spawnEngine, type EngineHandle } from './engine-client.js';
import { createTray, type TrayController } from './tray.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RENDERER_DIST = resolvePath(__dirname, '../renderer');
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];

let engine: EngineHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
let workflows: readonly WorkflowSummary[] = [];
let isQuitting = false;

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
            sandbox: true,
        },
    });

    if (RENDERER_DEV_URL) {
        window.webContents.openDevTools({ mode: 'detach' });
    }
    if (RENDERER_DEV_URL) {
        void window.loadURL(RENDERER_DEV_URL);
    } else {
        void window.loadFile(resolvePath(RENDERER_DIST, 'index.html'));
    }

    window.once('ready-to-show', () => {
        window.show();
    });

    window.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            window.hide();
        }
    });

    window.webContents.on('console-message', (event) => {
        const { level, message, lineNumber, sourceId } = event;

        console.log(`[renderer ${level}] ${message} (${sourceId}:${lineNumber})`);
    });

    return window;
}

function showAppWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    mainWindow = createWindow();
}

function broadcastWorkflowsList(next: readonly WorkflowSummary[]): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send(RendererChannel.WorkflowsList, next);
        }
    }
}

function handleWorkflowsListChange(next: readonly WorkflowSummary[]): void {
    workflows = next;
    tray?.updateWorkflows(next);
    broadcastWorkflowsList(next);
}

function isRecordOfNodePositions(value: unknown): value is Readonly<Record<string, NodePosition>> {
    if (!value || typeof value !== 'object') return false;
    for (const val of Object.values(value as Record<string, unknown>)) {
        if (!val || typeof val !== 'object') return false;
        if (typeof (val as Record<string, unknown>).x !== 'number') return false;
        if (typeof (val as Record<string, unknown>).y !== 'number') return false;
    }
    return true;
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

    ipcMain.handle(RendererChannel.FireTestEvent, async (): Promise<void> => {
        engine?.fireTestEvent();
    });

    ipcMain.handle(RendererChannel.ToggleWorkflow, async (_event, id: unknown): Promise<void> => {
        if (typeof id === 'string') {
            engine?.toggleWorkflow(id);
        }
    });

    ipcMain.handle(
        RendererChannel.CreateWorkflow,
        async (
            _event,
            name: unknown,
            pipeline: unknown,
            positions: unknown,
        ): Promise<WorkflowSummary> => {
            if (typeof name !== 'string') throw new Error('Invalid workflow name');
            const parsed = parsePipeline(pipeline);
            if (!parsed.ok) throw new Error(`Invalid pipeline: ${parsed.error}`);
            if (!isRecordOfNodePositions(positions)) throw new Error('Invalid positions');
            if (!engine) throw new Error('Engine not ready');
            return await engine.createWorkflow(name, parsed.value, positions);
        },
    );

    ipcMain.handle(
        RendererChannel.UpdateWorkflow,
        async (
            _event,
            id: unknown,
            name: unknown,
            pipeline: unknown,
            positions: unknown,
        ): Promise<WorkflowSummary> => {
            if (typeof id !== 'string') throw new Error('Invalid workflow id');
            if (typeof name !== 'string') throw new Error('Invalid workflow name');
            const parsed = parsePipeline(pipeline);
            if (!parsed.ok) throw new Error(`Invalid pipeline: ${parsed.error}`);
            if (!isRecordOfNodePositions(positions)) throw new Error('Invalid positions');
            if (!engine) throw new Error('Engine not ready');
            return await engine.updateWorkflow(id, name, parsed.value, positions);
        },
    );

    ipcMain.handle(
        RendererChannel.DeleteWorkflow,
        async (_event, id: unknown): Promise<boolean> => {
            if (typeof id !== 'string') throw new Error('Invalid workflow id');
            if (!engine) throw new Error('Engine not ready');
            return await engine.deleteWorkflow(id);
        },
    );

    ipcMain.handle(
        RendererChannel.GetWorkflow,
        async (
            _event,
            id: unknown,
        ): Promise<{
            readonly name: string;
            readonly pipeline: CompiledPipeline;
            readonly positions: Readonly<
                Record<string, { readonly x: number; readonly y: number }>
            >;
        } | null> => {
            if (typeof id !== 'string' || !engine) return null;
            try {
                const result = await engine.getWorkflow(id);
                if (result.found) {
                    return {
                        name: result.name,
                        pipeline: result.pipeline,
                        positions: result.positions,
                    };
                }
                return null;
            } catch (err) {
                console.error('[main] getWorkflow failed:', err);
                return null;
            }
        },
    );
}

function forwardEngineLogsToRenderer(): void {
    if (!engine) return;
    const unsubscribe = engine.onLog((line) => {
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
                window.webContents.send(RendererChannel.EngineLog, line);
            }
        }
    });
    app.on('before-quit', unsubscribe);
}

function subscribeToWorkflowsList(): void {
    if (!engine) return;
    const unsubscribe = engine.onWorkflowsList((next) => {
        handleWorkflowsListChange(next);
    });
    app.on('before-quit', unsubscribe);
}

app.whenReady().then(() => {
    engine = spawnEngine();

    engine.onReady(() => {
        console.log('[main] engine worker ready');
    });

    wireEngineIpc();
    forwardEngineLogsToRenderer();
    subscribeToWorkflowsList();

    tray = createTray({
        onToggleWorkflow: (id) => engine?.toggleWorkflow(id),
        onOpenApp: () => showAppWindow(),
        onQuit: () => {
            app.quit();
        },
    });

    tray.updateWorkflows(workflows);
    mainWindow = createWindow();

    mainWindow.webContents.on('did-finish-load', () => {
        broadcastWorkflowsList(workflows);
    });

    app.on('activate', () => {
        showAppWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) {
        app.quit();
    }
});

app.on('before-quit', async () => {
    isQuitting = true;
    tray?.destroy();
    tray = null;
    if (engine) {
        await engine.terminate();
        engine = null;
    }
});
