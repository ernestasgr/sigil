import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import {
    EngineChannel,
    type EngineCreateWorkflow,
    type EngineDeleteWorkflow,
    type EngineFireTestEvent,
    type EngineGetWorkflow,
    type EngineLog,
    type EnginePing,
    type EnginePong,
    type EngineToggleWorkflow,
    type EngineUpdateWorkflow,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';
import { createEngine } from './engine.js';
import { readPropertiesFile } from './properties-loader.js';
import { assertNever } from '../shared/assert-never.js';
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
    | EngineGetWorkflow;

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

process.on('exit', () => {
    engine.dispose();
});

const workflowsDir = join(userDataPath ?? '', 'workflows');
const store = createWorkflowStore(workflowsDir);

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
            }
            broadcastWorkflowsList();
            break;
        }
        case EngineChannel.CreateWorkflow: {
            const summary = store.create(message.name, message.pipeline);
            log(`Created workflow "${message.name}" (${summary.id})`);
            broadcastWorkflowsList();
            break;
        }
        case EngineChannel.UpdateWorkflow: {
            const summary = store.save(message.id, message.name, message.pipeline);
            log(`Updated workflow "${message.name}" (${summary.id})`);
            broadcastWorkflowsList();
            break;
        }
        case EngineChannel.DeleteWorkflow: {
            const removed = store.remove(message.id);
            if (removed) {
                log(`Deleted workflow (${message.id})`);
            }
            broadcastWorkflowsList();
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
        default: {
            assertNever(message);
        }
    }
});

broadcastWorkflowsList();

port.postMessage({ type: 'engine:ready' });
