import { parentPort } from 'node:worker_threads';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import {
    EngineChannel,
    type EngineFireTestEvent,
    type EngineLog,
    type EnginePing,
    type EnginePong,
    type EngineToggleWorkflow,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';
import { createEngine } from './engine.js';
import { assertNever } from '../shared/assert-never.js';
import { toggleWorkflow, type WorkflowRegistryState } from './workflow-registry.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

type WorkerInbound = EnginePing | EngineFireTestEvent | EngineToggleWorkflow;

const engine = createEngine();

const seedWorkflows: WorkflowRegistryState = [
    { id: 'sort-downloads', name: 'Sort Downloads', enabled: false },
    { id: 'notify-build', name: 'Notify Build', enabled: true },
    { id: 'clean-tmp', name: 'Clean Tmp', enabled: false },
];

let registry: WorkflowRegistryState = seedWorkflows;

function broadcastWorkflowsList(): void {
    const message: EngineWorkflowsList = {
        type: EngineChannel.WorkflowsList,
        workflows: registry,
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
            try {
                engine.execute(sampleManualTriggerToLog);
            } catch (err) {
                console.error('[worker] engine.execute failed:', err);
                const log: EngineLog = {
                    type: EngineChannel.Log,
                    line: `[error] engine.execute failed: ${err instanceof Error ? err.message : String(err)}`,
                };
                port.postMessage(log);
            }
            break;
        }
        case EngineChannel.ToggleWorkflow: {
            const before = registry.find((w) => w.id === message.id);
            registry = toggleWorkflow(registry, message.id);
            const after = registry.find((w) => w.id === message.id);
            if (before && after) {
                log(`[tray] "${before.name}" ${after.enabled ? 'enabled' : 'disabled'}`);
            }
            broadcastWorkflowsList();
            break;
        }
        default: {
            assertNever(message);
        }
    }
});

broadcastWorkflowsList();

port.postMessage({ type: 'engine:ready' });
