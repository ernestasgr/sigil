import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { Effect, Match } from 'effect';
import { z } from 'zod';
import {
    type EngineBusEvent,
    EngineChannel,
    type EngineLog,
    type EngineWorkflowsList,
    WorkerInboundSchema,
} from '../shared/ipc-channels.js';
import { type DispatchSubsystems, dispatch } from './dispatch.js';
import { createEngine } from './engine.js';
import { readPropertiesFile } from './properties-loader.js';
import { workflowTopologyOptions } from './workflow-acceptance.js';
import { createWorkflowActivator } from './workflow-activator.js';
import { createWorkflowStore } from './workflow-store.js';

if (!parentPort) {
    throw new Error('engine worker must be spawned as a worker_thread');
}

const port = parentPort;

const WorkerDataSchema = z.object({ userDataPath: z.string().optional() });
const parsedWorkerData = WorkerDataSchema.safeParse(workerData);
const userDataPath = parsedWorkerData.success ? parsedWorkerData.data.userDataPath : undefined;

const cwdPropertiesPath = join(process.cwd(), 'sigil.properties.json');
const userDataPropertiesPath = join(userDataPath ?? '', 'sigil.properties.json');
const propertiesPath = existsSync(cwdPropertiesPath) ? cwdPropertiesPath : userDataPropertiesPath;

const overridesPath = join(userDataPath ?? '', 'permission-overrides.json');

const engine = createEngine({
    properties: readPropertiesFile(propertiesPath).pipe(
        Effect.catchAll(() => Effect.succeed({})),
        Effect.runSync,
    ),
    defaultDatabasePath: join(userDataPath ?? '', 'sigil.db'),
    permissionOverridesPath: overridesPath,
});

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

// Load builtin node plugins (file-watcher, file-manager) first, then any
// user-installed TS node plugins from the user data directory.
const pluginsDir = join(userDataPath ?? '', 'plugins');
const pluginResults = await engine.loadNodePlugins(pluginsDir).catch((err: unknown) => {
    log(`Failed to load node plugins: ${err instanceof Error ? err.message : String(err)}`);
    return [] as const;
});
for (const result of pluginResults) {
    if (!result.ok) {
        const err = result.error;
        Match.value(err).pipe(
            Match.when({ kind: 'type_mismatch' }, (e) =>
                log(
                    `Plugin load failed (${e.dir}): type mismatch — manifest "${e.manifestType}" vs handler "${e.descriptorType}"`,
                ),
            ),
            Match.when({ kind: 'invalid_manifest' }, (e) =>
                log(`Plugin load failed (${e.dir}): invalid manifest — ${e.error}`),
            ),
            Match.when({ kind: 'import_error' }, (e) =>
                log(`Plugin load failed (${e.dir}): import error — ${e.error}`),
            ),
            Match.when({ kind: 'invalid_handler_module' }, (e) =>
                log(`Plugin load failed (${e.dir}): invalid handler module — ${e.error}`),
            ),
            Match.when({ kind: 'duplicate' }, (e) =>
                log(`Plugin load failed (${e.dir}): duplicate plugin — ${e.pluginId}`),
            ),
            Match.when({ kind: 'duplicate_type' }, (e) =>
                log(`Plugin load failed (${e.dir}): duplicate type — ${e.nodeType}`),
            ),
            Match.when({ kind: 'missing_manifest' }, (e) =>
                log(`Plugin load failed (${e.dir}): missing manifest`),
            ),
            Match.when({ kind: 'missing_handler' }, (e) =>
                log(`Plugin load failed (${e.dir}): missing handler`),
            ),
            Match.when({ kind: 'missing_node_type' }, (e) =>
                log(`Plugin load failed (${e.dir}): missing node type`),
            ),
            Match.when({ kind: 'worker_error' }, (e) =>
                log(`Plugin load failed (${e.dir}): worker error — ${e.error}`),
            ),
            Match.exhaustive,
        );
    }
}

const workflowsDir = join(userDataPath ?? '', 'workflows');
const store = createWorkflowStore(workflowsDir, workflowTopologyOptions(engine.handlerRegistry));

function broadcastWorkflowsList(): void {
    const message: EngineWorkflowsList = {
        type: EngineChannel.WorkflowsList,
        workflows: store.list(),
    };
    port.postMessage(message);
}

const activator = createWorkflowActivator(
    engine,
    store,
    engine.handlerRegistry,
    broadcastWorkflowsList,
);

process.on('exit', () => {
    activator.dispose();
    engine.dispose();
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
