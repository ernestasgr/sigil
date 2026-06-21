import { parentPort } from 'node:worker_threads';
import { EngineChannel, type EngineMessage, type EnginePong } from '../shared/ipc-channels.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

port.on('message', (message: EngineMessage) => {
    if (message.type === EngineChannel.Ping) {
        const pong: EnginePong = {
            id: message.id,
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        port.postMessage(pong);
    }
});

port.postMessage({ type: 'engine:ready' });
