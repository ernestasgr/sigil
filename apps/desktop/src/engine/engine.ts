import Database from 'better-sqlite3';

import type { CompiledPipeline } from '@sigil/schema';
import {
    DEFAULT_PROPERTIES,
    loadPropertiesFile,
    type ResolvedProperties,
} from '@sigil/schema/properties-file';

import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { resolve as resolvePath } from 'node:path';

import { fileURLToPath } from 'node:url';

import type { Bridge } from './bridge.js';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { executePipeline, type ExecutorSettings } from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createFileWatcherManager, type FileWatcherManager } from './file-watcher-manager.js';
import type { ManifestRegistry } from './manifest-registry.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { createNodeHandlerRegistry, type NodeHandlerRegistry } from './node-registry.js';
import { loadNodePlugins, type NodePluginLoadResult } from './node-plugin-loader.js';
import type { PermissionOverrideStore } from './permission-override-store.js';
import { createPermissionOverrideStore } from './permission-override-store.js';
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
    readonly permissionOverrides: PermissionOverrideStore;
    readonly loader: PluginLoader;
    readonly stateStore: PluginStateStore;
    readonly workflowStateStore: WorkflowStateStore;
    readonly settings: ExecutorSettings;
    readonly fileWatcherManager: FileWatcherManager;
    readonly handlerRegistry: NodeHandlerRegistry;
    readonly registerBuiltinManifests: () => void;
    readonly loadNodePlugins: (dir?: string) => Promise<readonly NodePluginLoadResult[]>;
    readonly execute: (pipeline: CompiledPipeline, seedContext?: WorkflowContext) => Promise<void>;
    readonly dispose: () => void;
}

export function resolveSettings(properties: ResolvedProperties): ExecutorSettings {
    return {
        notifyOnWorkflowError: properties.notifyOnWorkflowError,
        collisionSuffixStyle: properties.collisionSuffixStyle,
    };
}

export function createEngine(options?: EngineOptions): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const permissionOverrides = createPermissionOverrideStore();
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
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

    const builtinPluginsDir = resolvePath(
        fileURLToPath(new URL('../builtin-plugins', import.meta.url)),
    );

    const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());

    return {
        bus,
        bridge,
        capabilityBroker,
        permissionOverrides,
        registry,
        loader,
        stateStore,
        workflowStateStore,
        settings,
        fileWatcherManager,
        handlerRegistry,
        registerBuiltinManifests: (): void => {
            /* builtin manifests are now loaded as part of loadNodePlugins */
        },
        loadNodePlugins: async (dir?: string): Promise<readonly NodePluginLoadResult[]> => {
            const kernel = { fileWatcherManager, capabilityBroker };
            const deps = { manifestRegistry: registry, handlerRegistry, kernel };
            const builtinResults = await loadNodePlugins(builtinPluginsDir, deps);
            if (dir) {
                const userResults = await loadNodePlugins(dir, deps);
                return [...builtinResults, ...userResults];
            }
            return builtinResults;
        },
        execute: (pipeline, seedContext) =>
            executePipeline(
                pipeline,
                bus,
                handlerRegistry,
                settings,
                undefined,
                workflowStateStore,
                capabilityBroker,
                seedContext,
            ),
        dispose: (): void => {
            fileWatcherManager.dispose();
            workflowStateStore.dispose();
            database.close();
        },
    };
}
