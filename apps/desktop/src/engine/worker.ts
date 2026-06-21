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
let registry: WorkflowRegistryState = [];

function broadcastWorkflowsList(): void {
    const message: EngineWorkflowsList = {
        type: EngineChannel.WorkflowsList,
        workflows: registry,
    };
    port.postMessage(message);
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
            registry = toggleWorkflow(registry, message.id);
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
