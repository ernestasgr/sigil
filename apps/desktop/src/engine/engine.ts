import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_PROPERTIES,
    loadPropertiesFile,
    type ResolvedProperties,
} from '@sigil/schema/properties-file';
import type { TopologyDiagnostic } from '@sigil/schema/topology';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import Database from 'better-sqlite3';

import type { Bridge } from './bridge.js';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { type ExecutorSettings, executeValidatedWorkflow } from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createFileWatcherManager, type FileWatcherManager } from './file-watcher-manager.js';
import type { ManifestRegistry } from './manifest-registry.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { loadNodePlugins, type NodePluginLoadResult } from './node-plugin-loader.js';
import { createNodeHandlerRegistry, type NodeHandlerRegistry } from './node-registry.js';
import type { PermissionOverrideStore } from './permission-override-store.js';
import { createPermissionOverrideStore } from './permission-override-store.js';
import { acceptWorkflow, type WorkflowInput } from './workflow-acceptance.js';
import { createWorkflowStateStore, type WorkflowStateStore } from './workflow-state.js';
import { createWorkflowTopologyError } from './workflow-topology-error.js';

export interface EngineOptions {
    readonly properties?: unknown;
    readonly defaultDatabasePath?: string;
    readonly permissionOverridesPath?: string;
}

export interface Engine {
    readonly bus: EventBus;
    readonly bridge: Bridge;
    readonly capabilityBroker: CapabilityBroker;
    readonly registry: ManifestRegistry;
    readonly permissionOverrides: PermissionOverrideStore;
    readonly workflowStateStore: WorkflowStateStore;
    readonly settings: ExecutorSettings;
    readonly fileWatcherManager: FileWatcherManager;
    readonly handlerRegistry: NodeHandlerRegistry;
    readonly registerBuiltinManifests: () => void;
    readonly loadNodePlugins: (dir?: string) => Promise<readonly NodePluginLoadResult[]>;
    readonly execute: (pipeline: WorkflowInput, seedContext?: WorkflowContext) => Promise<void>;
    readonly dispose: () => void;
}

export function resolveSettings(properties: ResolvedProperties): ExecutorSettings {
    return {
        notifyOnWorkflowError: properties.notifyOnWorkflowError,
        collisionSuffixStyle: properties.collisionSuffixStyle,
    };
}

function emitTopologyDiagnostics(bus: EventBus, diagnostics: readonly TopologyDiagnostic[]): void {
    for (const diagnostic of diagnostics) {
        bus.next({
            name: 'engine.diagnostic',
            payload: { message: `[topology:${diagnostic.code}] ${diagnostic.message}` },
        });
    }
}

export function createEngine(options?: EngineOptions): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const permissionOverrides = createPermissionOverrideStore(options?.permissionOverridesPath);
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);

    const propertiesResult = loadPropertiesFile(options?.properties, {
        databasePath: options?.defaultDatabasePath,
    });
    const properties = propertiesResult.ok ? propertiesResult.value : DEFAULT_PROPERTIES;
    const settings = resolveSettings(properties);

    const database = new Database(properties.databasePath);
    const workflowStateStore = createWorkflowStateStore(database);

    const fileWatcherManager = createFileWatcherManager();

    const __filename = fileURLToPath(import.meta.url);
    const builtinPluginsDir = resolvePath(dirname(__filename), '../../src/builtin-plugins');

    const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());

    return {
        bus,
        bridge,
        capabilityBroker,
        permissionOverrides,
        registry,
        workflowStateStore,
        settings,
        fileWatcherManager,
        handlerRegistry,
        registerBuiltinManifests: (): void => {
            /* builtin manifests are now loaded as part of loadNodePlugins */
        },
        loadNodePlugins: async (dir?: string): Promise<readonly NodePluginLoadResult[]> => {
            const kernel = { fileWatcherManager, capabilityBroker };
            const deps = {
                manifestRegistry: registry,
                handlerRegistry,
                kernel,
                bridge,
                permissionOverrides,
                diagnostic: (message: string): void => {
                    bus.next({ name: 'engine.diagnostic', payload: { message } });
                },
            };
            const builtinResults = await loadNodePlugins(builtinPluginsDir, deps);
            if (dir) {
                const userResults = await loadNodePlugins(dir, deps);
                return [...builtinResults, ...userResults];
            }
            return builtinResults;
        },
        execute: async (pipeline, seedContext): Promise<void> => {
            const topology = acceptWorkflow(pipeline, handlerRegistry);
            if (!topology.ok) {
                emitTopologyDiagnostics(bus, topology.diagnostics);
                throw createWorkflowTopologyError(topology.diagnostics);
            }

            return executeValidatedWorkflow(
                topology.value,
                bus,
                handlerRegistry,
                settings,
                undefined,
                workflowStateStore,
                capabilityBroker,
                seedContext,
            );
        },
        dispose: (): void => {
            fileWatcherManager.dispose();
            workflowStateStore.dispose();
            database.close();
        },
    };
}
