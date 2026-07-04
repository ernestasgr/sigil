import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import {
    EngineChannel,
    WorkerInboundSchema,
    type EngineBusEvent,
    type EngineLog,
    type EnginePong,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';
import type { PluginInfo } from '../shared/plugin-info.js';
import { createEngine } from './engine.js';
import { readPropertiesFile, writePropertiesFile } from './properties-loader.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

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

port.on('message', (raw: unknown) => {
    const parsed = WorkerInboundSchema.safeParse(raw);
    if (!parsed.success) {
        const errMsg = parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        console.error(`[worker] invalid message envelope: ${errMsg}`);
        port.postMessage({
            type: EngineChannel.Log,
            line: `[error] invalid message envelope: ${errMsg}`,
        });
        return;
    }
    const message = parsed.data;
    try {
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
            case EngineChannel.FireManualTrigger: {
                void engine.execute(message.pipeline).catch((err: unknown) => {
                    console.error('[worker] manual trigger execution failed:', err);
                    const log: EngineLog = {
                        type: EngineChannel.Log,
                        line: `[error] manual trigger execution failed: ${err instanceof Error ? err.message : String(err)}`,
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
                    log(
                        `Created workflow "${message.name}" via update for missing id (${summary.id})`,
                    );
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
                const properties =
                    current && typeof current === 'object' && !Array.isArray(current)
                        ? (current as Record<string, unknown>)
                        : {};
                port.postMessage({
                    type: EngineChannel.ReadPropertiesResult,
                    correlationId: message.correlationId,
                    properties,
                });
                break;
            }
            case EngineChannel.SaveProperties: {
                const result = writePropertiesFile(propertiesPath, message.properties);
                if (!result.ok) {
                    log(`Failed to save properties: ${result.error}`);
                }
                port.postMessage({
                    type: EngineChannel.SavePropertiesResult,
                    correlationId: message.correlationId,
                    ok: result.ok,
                });
                break;
            }
            case EngineChannel.ReadWorkflowState: {
                const entries = engine.workflowStateStore.listKeys(message.workflowId);
                port.postMessage({
                    type: EngineChannel.ReadWorkflowStateResult,
                    correlationId: message.correlationId,
                    entries,
                });
                break;
            }
            case EngineChannel.SetWorkflowStateKey: {
                engine.workflowStateStore.setKey(message.workflowId, message.key, message.value);
                port.postMessage({
                    type: EngineChannel.SetWorkflowStateKeyResult,
                    correlationId: message.correlationId,
                    ok: true,
                });
                break;
            }
            case EngineChannel.DeleteWorkflowStateKey: {
                engine.workflowStateStore.deleteKey(message.workflowId, message.key);
                port.postMessage({
                    type: EngineChannel.DeleteWorkflowStateKeyResult,
                    correlationId: message.correlationId,
                    ok: true,
                });
                break;
            }
            default: {
                const _exhaustive: never = message;
                void _exhaustive;
                const errMsg = `[worker] unhandled message type: ${(message as unknown as { type: string }).type}`;
                console.error(errMsg);
                port.postMessage({
                    type: EngineChannel.Log,
                    line: `[error] unhandled message type (this is a bug)`,
                });
            }
        }
    } catch (err) {
        console.error('[worker] unhandled error processing message:', err);
        port.postMessage({
            type: EngineChannel.Log,
            line: `[error] unhandled error processing message: ${err instanceof Error ? err.message : String(err)}`,
        });
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

// Load built-in plugins so they appear in the registry before signaling ready
await engine.loadBuiltinPlugins().catch((err: unknown) => {
    log(`Failed to load built-in plugins: ${err instanceof Error ? err.message : String(err)}`);
});

port.postMessage({ type: 'engine:ready' });
