import Database from 'better-sqlite3';

import type { CompiledPipeline } from '@sigil/schema';
import {
    DEFAULT_PROPERTIES,
    loadPropertiesFile,
    type ResolvedProperties,
} from '@sigil/schema/properties-file';

import type { Bridge } from './bridge.js';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { executePipeline, type ExecutorSettings } from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import {
    FILE_WATCHER_PLUGIN_ID,
    fileWatcherManifest,
    fileWatcherPluginCode,
} from './file-watcher-plugin.js';
import { createFileWatcherManager, type FileWatcherManager } from './file-watcher-manager.js';
import type { ManifestRegistry } from './manifest-registry.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createInMemoryPluginStateStore, createPluginLoader } from './plugin-loader.js';
import type { PluginLoader, PluginStateStore } from './plugin-loader.js';
import { createWorkflowStateStore, type WorkflowStateStore } from './workflow-state.js';

export interface EngineOptions {
    readonly properties?: unknown;
    readonly defaultDatabasePath?: string;
}

export interface Engine {
    readonly bus: EventBus;
    readonly bridge: Bridge;
    readonly capabilityBroker: CapabilityBroker;
    readonly registry: ManifestRegistry;
    readonly loader: PluginLoader;
    readonly stateStore: PluginStateStore;
    readonly workflowStateStore: WorkflowStateStore;
    readonly settings: ExecutorSettings;
    readonly fileWatcherManager: FileWatcherManager;
    readonly loadBuiltinPlugins: () => Promise<void>;
    readonly execute: (pipeline: CompiledPipeline) => Promise<void>;
    readonly dispose: () => void;
}

export function resolveSettings(properties: ResolvedProperties): ExecutorSettings {
    return { notifyOnWorkflowError: properties.notifyOnWorkflowError };
}

export function createEngine(options?: EngineOptions): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry);
    const stateStore = createInMemoryPluginStateStore();
    const loader = createPluginLoader({
        bus,
        registry,
        bridge,
        broker: capabilityBroker,
        stateStore,
    });

    const propertiesResult = loadPropertiesFile(options?.properties, {
        databasePath: options?.defaultDatabasePath,
    });
    const properties = propertiesResult.ok ? propertiesResult.value : DEFAULT_PROPERTIES;
    const settings = resolveSettings(properties);

    const database = new Database(properties.databasePath);
    const workflowStateStore = createWorkflowStateStore(database);

    const fileWatcherManager = createFileWatcherManager();

    return {
        bus,
        bridge,
        capabilityBroker,
        registry,
        loader,
        stateStore,
        workflowStateStore,
        settings,
        fileWatcherManager,
        loadBuiltinPlugins: async (): Promise<void> => {
            if (!registry.has(FILE_WATCHER_PLUGIN_ID)) {
                const result = await loader.load(fileWatcherManifest, fileWatcherPluginCode);
                if (!result.ok) {
                    bus.next({
                        name: 'log.output',
                        payload: {
                            message: `[engine] failed to load file-watcher plugin: ${result.error.kind}`,
                        },
                    });
                }
            }
        },
        execute: (pipeline) =>
            executePipeline(pipeline, bus, settings, undefined, workflowStateStore),
        dispose: (): void => {
            fileWatcherManager.dispose();
            workflowStateStore.dispose();
            database.close();
        },
    };
}
