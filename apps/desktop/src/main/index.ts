import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Either } from 'effect';
import { app, BrowserWindow, Notification } from 'electron';

import { safeParsePayload } from '../shared/event-payload-schemas.js';
import type { EngineBusEventPayload } from '../shared/ipc-channels.js';
import { WorkflowIdSchema, type WorkflowSummary } from '../shared/workflow.js';
import { electronTrpcMain } from './electron-trpc-main.js';
import { type EngineHandle, spawnEngine } from './engine-client.js';
import { createQuitCoordinator } from './quit-coordinator.js';
import { createTray, type TrayController } from './tray/tray.js';
import { createAppRouter } from './trpc/router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RENDERER_DIST = resolvePath(__dirname, '../renderer');
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

let engine: EngineHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let trpcHandler: { readonly attachWindow: (window: BrowserWindow) => void } | null = null;
let tray: TrayController | null = null;
let workflows: readonly WorkflowSummary[] = [];
let isQuitting = false;

const quitCoordinator = createQuitCoordinator({
    getEngine: () => engine,
    destroyTray: () => {
        tray?.destroy();
        tray = null;
    },
    requestQuit: () => {
        app.quit();
    },
    onFailure: (phase, error) => {
        console.error(`[main] quit ${phase} failed:`, error);
    },
});

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
    trpcHandler?.attachWindow(window);

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

function handleWorkflowsListChange(next: readonly WorkflowSummary[]): void {
    workflows = next;
    tray?.updateWorkflows(next);
}

function subscribeToWorkflowsList(): void {
    if (!engine) return;
    const unsubscribe = engine.onWorkflowsList((next) => {
        handleWorkflowsListChange(next);
    });
    app.on('before-quit', unsubscribe);
}

function handleOsNotifications(): void {
    if (!engine) return;
    const unsubscribe = engine.onBusEvent((event: EngineBusEventPayload) => {
        if (event.name === 'notification.show') {
            const result = safeParsePayload(event.name, event.payload);
            if (Either.isRight(result)) {
                const { title, body } = result.right;
                new Notification({ title, body }).show();
            }
        }
    });
    app.on('before-quit', unsubscribe);
}

app.whenReady().then(() => {
    engine = spawnEngine();

    const router = createAppRouter({
        getEngine: () => engine,
        getMainWindow: () => mainWindow,
        getWorkflows: () => workflows,
    });
    trpcHandler = electronTrpcMain.createIPCHandler({ router });

    engine.onReady(() => {
        console.log('[main] engine worker ready');
    });

    handleOsNotifications();
    subscribeToWorkflowsList();

    tray = createTray({
        onToggleWorkflow: (id) => {
            const workflowId = WorkflowIdSchema.safeParse(id);
            if (!workflowId.success) {
                console.error(`[main] refusing to toggle invalid workflow id: ${id}`);
                return;
            }
            void engine?.toggleWorkflow({ id: workflowId.data });
        },
        onOpenApp: () => showAppWindow(),
        onQuit: () => {
            app.quit();
        },
    });

    tray.updateWorkflows(workflows);
    mainWindow = createWindow();

    app.on('activate', () => {
        showAppWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) {
        app.quit();
    }
});

app.on('before-quit', (event) => {
    isQuitting = true;
    void quitCoordinator.beforeQuit(event);
});
