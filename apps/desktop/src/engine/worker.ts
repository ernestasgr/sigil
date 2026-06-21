import { parentPort } from 'node:worker_threads';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import {
    EngineChannel,
    type EngineFireTestEvent,
    type EngineLog,
    type EnginePing,
    type EnginePong,
} from '../shared/ipc-channels.js';
import { createEngine } from './engine.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

type WorkerInbound = EnginePing | EngineFireTestEvent;

function assertNever(value: never): never {
    throw new Error(`Unhandled engine message: ${JSON.stringify(value)}`);
}

const engine = createEngine();

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
            engine.execute(sampleManualTriggerToLog);
            break;
        }
        default: {
            assertNever(message);
        }
    }
});

port.postMessage({ type: 'engine:ready' });
