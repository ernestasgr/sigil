import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import {
    EngineChannel,
    type EngineBusEvent,
    type EngineCreateWorkflow,
    type EngineDeleteWorkflow,
    type EngineFireTestEvent,
    type EngineGetWorkflow,
    type EngineListPlugins,
    type EngineLog,
    type EnginePing,
    type EnginePong,
    type EngineReadProperties,
    type EngineSaveProperties,
    type EngineSetPermissionOverride,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import { createEngine } from './engine.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';
import { assertNever } from '../shared/assert-never.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

type WorkerInbound =
    | EnginePing
    | EngineFireTestEvent
    | EngineToggleWorkflow
    | EngineCreateWorkflow
    | EngineUpdateWorkflow
    | EngineDeleteWorkflow
    | EngineGetWorkflow
    | EngineListPlugins
    | EngineSetPermissionOverride
    | EngineReadProperties
    | EngineSaveProperties;

const userDataPath =
    typeof workerData === 'object' && workerData !== null
        ? (workerData as { userDataPath?: string }).userDataPath
        : undefined;

const cwdPropertiesPath = join(process.cwd(), 'sigil.properties.json');
const userDataPropertiesPath = join(userDataPath ?? '', 'sigil.properties.json');
const propertiesPath = existsSync(cwdPropertiesPath) ? cwdPropertiesPath : userDataPropertiesPath;

const engine = createEngine({
    properties: readPropertiesFile(propertiesPath),
    defaultDatabasePath: join(userDataPath ?? '', 'sigil.db'),
});

const workflowsDir = join(userDataPath ?? '', 'workflows');
const store = createWorkflowStore(workflowsDir);
const activator = createWorkflowActivator(engine, store, engine.fileWatcherManager);

process.on('exit', () => {
    activator.dispose();
    engine.dispose();
});

function broadcastWorkflowsList(): void {
    const message: EngineWorkflowsList = {
        type: EngineChannel.WorkflowsList,
        workflows: store.list(),
    };
    port.postMessage(message);
}

function log(message: string): void {
    engine.bus.next({ name: 'log.output', payload: { message } });
}

engine.bus.subscribe((event) => {
    const busEvent: EngineBusEvent = { type: EngineChannel.BusEvent, event };
    port.postMessage(busEvent);
    if (event.name === 'log.output') {
        const log: EngineLog = { type: EngineChannel.Log, line: event.payload.message };
        port.postMessage(log);
    }
});

port.on('message', (message: WorkerInbound) => {
    switch (message.type) {
        case EngineChannel.Ping: {
            const pong: EnginePong = {
                id: message.id,
                type: EngineChannel.Pong,
                receivedAt: Date.now(),
            };
            port.postMessage(pong);
            break;
        }
        case EngineChannel.FireTestEvent: {
            void engine.execute(sampleManualTriggerToLog).catch((err: unknown) => {
                console.error('[worker] engine.execute failed:', err);
                const log: EngineLog = {
                    type: EngineChannel.Log,
                    line: `[error] engine.execute failed: ${err instanceof Error ? err.message : String(err)}`,
                };
                port.postMessage(log);
            });
            break;
        }
        case EngineChannel.ToggleWorkflow: {
            const before = store.get(message.id);
            const toggled = store.toggle(message.id);
            if (before && toggled) {
                log(`"${before.name}" ${toggled.enabled ? 'enabled' : 'disabled'}`);
                if (toggled.enabled) {
                    activator.activate(message.id);
                } else {
                    activator.deactivate(message.id);
                }
            }
            broadcastWorkflowsList();
            port.postMessage({
                type: EngineChannel.ToggleWorkflowResult,
                correlationId: message.correlationId,
                summary: toggled,
            });
            break;
        }
        case EngineChannel.CreateWorkflow: {
            const summary = store.create(message.name, message.pipeline, message.positions);
            log(`Created workflow "${message.name}" (${summary.id})`);
            broadcastWorkflowsList();
            port.postMessage({
                type: EngineChannel.CreateWorkflowResult,
                correlationId: message.correlationId,
                summary,
            });
            break;
        }
        case EngineChannel.UpdateWorkflow: {
            activator.deactivate(message.id);
            const existed = store.get(message.id) !== null;
            const summary = store.save(
                message.id,
                message.name,
                message.pipeline,
                message.positions,
            );
            if (existed) {
                log(`Updated workflow "${message.name}" (${summary.id})`);
                if (summary.enabled) {
                    activator.activate(message.id);
                }
            } else {
                log(`Created workflow "${message.name}" via update for missing id (${summary.id})`);
            }
            broadcastWorkflowsList();
            port.postMessage({
                type: EngineChannel.UpdateWorkflowResult,
                correlationId: message.correlationId,
                summary,
            });
            break;
        }
        case EngineChannel.DeleteWorkflow: {
            activator.deactivate(message.id);
            const removed = store.remove(message.id);
            if (removed) {
                log(`Deleted workflow (${message.id})`);
            }
            broadcastWorkflowsList();
            port.postMessage({
                type: EngineChannel.DeleteWorkflowResult,
                correlationId: message.correlationId,
                success: removed,
            });
            break;
        }
        case EngineChannel.GetWorkflow: {
            const data = store.get(message.id);
            if (data) {
                port.postMessage({
                    type: EngineChannel.GetWorkflowResult,
                    correlationId: message.correlationId,
                    found: true,
                    name: data.name,
                    pipeline: data.pipeline,
                    positions: data.positions,
                });
            } else {
                port.postMessage({
                    type: EngineChannel.GetWorkflowResult,
                    correlationId: message.correlationId,
                    found: false,
                    error: `Workflow not found: ${message.id}`,
                });
            }
            break;
        }
        case EngineChannel.ListPlugins: {
            const manifests = engine.registry.all();
            const plugins: readonly PluginInfo[] = manifests.map((manifest) => ({
                manifest,
                grantedPermissions: engine.permissionOverrides.has(manifest.id)
                    ? engine.permissionOverrides.get(manifest.id)
                    : manifest.permissions,
            }));
            port.postMessage({
                type: EngineChannel.ListPluginsResult,
                correlationId: message.correlationId,
                plugins,
            });
            break;
        }
        case EngineChannel.SetPermissionOverride: {
            engine.permissionOverrides.set(message.pluginId, message.overrides);
            port.postMessage({
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: message.correlationId,
                ok: true,
            });
            break;
        }
        case EngineChannel.ReadProperties: {
            const current = readPropertiesFile(propertiesPath);
            port.postMessage({
                type: EngineChannel.ReadPropertiesResult,
                correlationId: message.correlationId,
                properties: current as Record<string, unknown>,
            });
            break;
        }
        case EngineChannel.SaveProperties: {
            const result = writePropertiesFile(propertiesPath, message.properties);
            port.postMessage({
                type: EngineChannel.SavePropertiesResult,
                correlationId: message.correlationId,
                ok: result.ok,
            });
            break;
        }
        default: {
            assertNever(message);
        }
    }
});

for (const wf of store.list()) {
    if (wf.enabled) {
        try {
            activator.activate(wf.id);
        } catch (err) {
            const log: EngineLog = {
                type: EngineChannel.Log,
                line: `[worker] failed to activate workflow ${wf.id} (${wf.name}): ${err instanceof Error ? err.message : String(err)}`,
            };
            port.postMessage(log);
        }
    }
}

broadcastWorkflowsList();

port.postMessage({ type: 'engine:ready' });
