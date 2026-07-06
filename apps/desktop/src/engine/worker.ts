import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import {
    EngineChannel,
    WorkerInboundSchema,
    type EngineBusEvent,
    type EngineLog,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';
import { createEngine } from './engine.js';
import { readPropertiesFile } from './properties-loader.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';
import { dispatch, type DispatchSubsystems } from './dispatch.js';

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
const activator = createWorkflowActivator(engine, store, engine.handlerRegistry);

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
    engine.bus.next({ name: 'engine.diagnostic', payload: { message } });
}

engine.bus.subscribe((event) => {
    const busEvent: EngineBusEvent = { type: EngineChannel.BusEvent, event };
    port.postMessage(busEvent);
    if (event.name === 'log.output') {
        const log: EngineLog = { type: EngineChannel.Log, line: event.payload.message };
        port.postMessage(log);
    }
});

const subsystems: DispatchSubsystems = {
    postMessage: (msg: unknown) => port.postMessage(msg),
    engine,
    store,
    activator,
    broadcastWorkflowsList,
    log,
    propertiesPath,
};

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
        dispatch(message, subsystems);
    } catch (err) {
        console.error('[worker] unhandled error processing message:', err);
        port.postMessage({
            type: EngineChannel.Log,
            line: `[error] unhandled error processing message: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
});

// Register builtin node manifests (permission identities) and load any
// user-installed TS node plugins before activating workflows.
engine.registerBuiltinManifests();

const pluginsDir = join(userDataPath ?? '', 'plugins');
const pluginResults = await engine.loadNodePlugins(pluginsDir).catch((err: unknown) => {
    log(`Failed to load node plugins: ${err instanceof Error ? err.message : String(err)}`);
    return [] as const;
});
for (const result of pluginResults) {
    if (!result.ok) {
        const err = result.error;
        const dir = 'dir' in err ? err.dir : '(unknown dir)';
        const detail =
            'error' in err
                ? err.error
                : 'pluginId' in err
                  ? err.pluginId
                  : 'nodeType' in err
                    ? err.nodeType
                    : err.kind;
        log(`Plugin load failed (${dir}): ${err.kind}: ${detail}`);
    }
}

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
