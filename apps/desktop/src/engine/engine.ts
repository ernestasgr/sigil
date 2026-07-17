import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createPropertyRegistry,
    loadPropertiesFile,
    PROPERTY_REGISTRY,
    type PropertiesFile,
    type PropertyRegistry,
    type RegisteredResolvedProperties,
    type ResolvedProperties,
} from '@sigil/schema/properties-file';
import type { TopologyDiagnostic } from '@sigil/schema/topology';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import Database from 'better-sqlite3';

import type { Bridge } from './bridge.js';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import {
    type ExecutionOptions,
    type ExecutorSettings,
    executeValidatedWorkflow,
    type WorkflowExecutionResult,
} from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import type { EngineDiagnosticPayload } from './event-payload-schemas.js';
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
    readonly propertyRegistry: PropertyRegistry;
    readonly registerBuiltinManifests: () => void;
    readonly loadNodePlugins: (dir?: string) => Promise<readonly NodePluginLoadResult[]>;
    readonly execute: (
        pipeline: WorkflowInput,
        seedContext?: WorkflowContext,
        executionOptions?: ExecutionOptions,
    ) => Promise<WorkflowExecutionResult>;
    readonly dispose: () => void;
}

export function resolveSettings(
    resolvedProperties: ResolvedProperties,
    properties: PropertiesFile = {},
    propertyRegistry: PropertyRegistry = PROPERTY_REGISTRY,
): ExecutorSettings {
    return {
        notifyOnWorkflowError: resolvedProperties.notifyOnWorkflowError,
        collisionSuffixStyle: resolvedProperties.collisionSuffixStyle,
        properties: resolvedProperties,
        fileManager: {
            defaultOnConflict: resolvedProperties['file-manager.defaultOnConflict'],
            collisionSuffixStyle: propertyRegistry.resolve('file-manager.collisionSuffixStyle', {
                properties,
                fallback: resolvedProperties.collisionSuffixStyle,
            }),
        },
    };
}

function emitTopologyDiagnostics(bus: EventBus, diagnostics: readonly TopologyDiagnostic[]): void {
    for (const diagnostic of diagnostics) {
        bus.next({
            name: 'engine.diagnostic',
            payload: {
                message: `[topology:${diagnostic.code}] ${diagnostic.message}`,
                kind: 'topology',
                source: 'engine',
                outcome: 'failed',
            },
        });
    }
}

export function createEngine(options?: EngineOptions): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const permissionOverrides = createPermissionOverrideStore(options?.permissionOverridesPath);
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
    const propertyRegistry = createPropertyRegistry();
    const rawProperties = options?.properties ?? {};

    const resolveConfiguredProperties = (): {
        readonly resolved: RegisteredResolvedProperties;
        readonly properties: PropertiesFile;
    } => {
        const propertiesResult = loadPropertiesFile(
            rawProperties,
            { databasePath: options?.defaultDatabasePath },
            propertyRegistry,
        );
        return propertiesResult.ok
            ? { resolved: propertiesResult.value, properties: propertiesResult.properties }
            : {
                  resolved: propertyRegistry.resolveAll(
                      {},
                      { databasePath: options?.defaultDatabasePath },
                  ),
                  properties: {},
              };
    };

    let { resolved: resolvedProperties, properties } = resolveConfiguredProperties();

    let settings = resolveSettings(resolvedProperties, properties, propertyRegistry);
    const database = new Database(resolvedProperties.databasePath);
    const workflowStateStore = createWorkflowStateStore(database);

    const fileWatcherManager = createFileWatcherManager(
        resolvedProperties['file-watcher.ignorePatterns'],
    );

    const __filename = fileURLToPath(import.meta.url);
    const builtinPluginsDir = resolvePath(dirname(__filename), '../../src/builtin-plugins');

    const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());

    const refreshResolvedProperties = (): void => {
        const next = resolveConfiguredProperties();
        resolvedProperties = next.resolved;
        properties = next.properties;
        settings = resolveSettings(resolvedProperties, properties, propertyRegistry);
        fileWatcherManager.setDefaultIgnorePatterns(
            resolvedProperties['file-watcher.ignorePatterns'],
        );
    };

    return {
        bus,
        bridge,
        capabilityBroker,
        permissionOverrides,
        registry,
        propertyRegistry,
        workflowStateStore,
        get settings() {
            return settings;
        },
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
                propertyRegistry,
                diagnosticEvent: (event: EngineDiagnosticPayload): void => {
                    bus.next({ name: 'engine.diagnostic', payload: event });
                },
            };
            const builtinResults = await loadNodePlugins(builtinPluginsDir, {
                ...deps,
                allowExistingPropertyDescriptors: true,
            });
            refreshResolvedProperties();
            if (dir) {
                const userResults = await loadNodePlugins(dir, deps);
                refreshResolvedProperties();
                return [...builtinResults, ...userResults];
            }
            return builtinResults;
        },
        execute: async (
            pipeline,
            seedContext,
            executionOptions,
        ): Promise<WorkflowExecutionResult> => {
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
                executionOptions,
            );
        },
        dispose: (): void => {
            fileWatcherManager.dispose();
            workflowStateStore.dispose();
            database.close();
        },
    };
}
