import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capability } from '@sigil/schema/manifest';
import {
    createBuiltinNodeContractRegistry,
    type NodeContractRegistry,
} from '@sigil/schema/node-contract';
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
import type { EngineDiagnosticPayload } from '../../shared/event-payload-schemas.js';
import type { PermissionOverrideOutcome } from '../../shared/persistence.js';
import type { Bridge } from '../events/bridge.js';
import { createBridge } from '../events/bridge.js';
import type { EventBus } from '../events/event-bus.js';
import { createEventBus } from '../events/event-bus.js';
import {
    type ExecutionOptions,
    type ExecutorSettings,
    executeValidatedWorkflow,
    type WorkflowExecutionResult,
} from '../execution/dag-executor.js';
import { createNodeHandlerRegistry, type NodeHandlerRegistry } from '../execution/node-registry.js';
import { createBuiltinHandlers } from '../node-handlers/registry.js';
import type { CapabilityBroker } from '../persistence/capability-broker.js';
import { createCapabilityBroker } from '../persistence/capability-broker.js';
import type { PermissionOverrideStore } from '../persistence/permission-override-store.js';
import { createPermissionOverrideStore } from '../persistence/permission-override-store.js';
import {
    createFileWatcherManager,
    type FileWatcherManager,
} from '../plugins/file-watcher-manager.js';
import type { ManifestRegistry } from '../plugins/manifest-registry.js';
import { createManifestRegistry } from '../plugins/manifest-registry.js';
import {
    createNodePluginLoader,
    type NodePluginLoadResult,
} from '../plugins/node-plugin-loader.js';
import { acceptWorkflow, type WorkflowInput } from '../workflow/workflow-acceptance.js';
import { createWorkflowStateStore, type WorkflowStateStore } from '../workflow/workflow-state.js';
import { createWorkflowTopologyError } from '../workflow/workflow-topology-error.js';
import {
    applyPermissionOverride as applyPermissionOverrideTransition,
    type PermissionTransitionRunReconciler,
} from './permission-transition.js';

export interface EngineOptions {
    readonly properties?: unknown;
    readonly defaultDatabasePath?: string;
    readonly permissionOverridesPath?: string;
}

export type PropertyValidationResult =
    | { readonly ok: true; readonly properties: PropertiesFile }
    | {
          readonly ok: false;
          readonly kind: 'validation';
          readonly error: string;
          readonly issues: readonly string[];
      };

export interface PropertyApplyResult {
    readonly applied: Readonly<Record<string, unknown>>;
    readonly restartRequired: readonly string[];
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
    /** Shared topology and runtime contract lookup for built-in Nodes. */
    readonly contractRegistry: NodeContractRegistry;
    readonly propertyRegistry: PropertyRegistry;
    readonly validateProperties: (
        properties: Readonly<Record<string, unknown>>,
    ) => PropertyValidationResult;
    readonly applyProperties: (properties: PropertiesFile) => PropertyApplyResult;
    readonly loadBuiltinPlugins: () => Promise<readonly NodePluginLoadResult[]>;
    readonly applyPermissionOverride: (
        pluginId: string,
        overrides: readonly Capability[],
    ) => Promise<PermissionOverrideOutcome>;
    readonly registerPermissionTransitionReconciler: (
        reconciler: PermissionTransitionRunReconciler,
    ) => () => void;
    readonly updatePluginPermissions: (
        pluginId: string,
        permissions: readonly Capability[],
    ) => void;
    readonly execute: (
        pipeline: WorkflowInput,
        seedContext?: WorkflowContext,
        executionOptions?: ExecutionOptions,
    ) => Promise<WorkflowExecutionResult>;
    /** Await plugin workers and all other engine resources during graceful shutdown. */
    readonly shutdown: () => Promise<void>;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyValuesEqual(first: unknown, second: unknown): boolean {
    if (Object.is(first, second)) return true;
    if (Array.isArray(first) && Array.isArray(second)) {
        return (
            first.length === second.length &&
            first.every((value, index) => propertyValuesEqual(value, second[index]))
        );
    }
    if (isRecord(first) && isRecord(second)) {
        const firstKeys = Object.keys(first);
        const secondKeys = Object.keys(second);
        return (
            firstKeys.length === secondKeys.length &&
            firstKeys.every(
                (key) => Object.hasOwn(second, key) && propertyValuesEqual(first[key], second[key]),
            )
        );
    }
    return false;
}

export function createEngine(options?: EngineOptions): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const permissionOverrides = createPermissionOverrideStore(options?.permissionOverridesPath);
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry, permissionOverrides);
    const propertyRegistry = createPropertyRegistry();
    let configuredProperties: unknown = options?.properties ?? {};

    const resolveConfiguredProperties = (): {
        readonly resolved: RegisteredResolvedProperties;
        readonly properties: PropertiesFile;
    } => {
        const propertiesResult = loadPropertiesFile(
            configuredProperties,
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
    const engineDir = dirname(__filename);
    const builtinPluginsDir = existsSync(resolvePath(engineDir, '../../src/builtin-plugins'))
        ? resolvePath(engineDir, '../../src/builtin-plugins')
        : resolvePath(engineDir, '../../builtin-plugins');

    const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
    const contractRegistry = createBuiltinNodeContractRegistry();
    const pluginLoader = createNodePluginLoader();
    let permissionTransitionReconciler: PermissionTransitionRunReconciler = async () => [];
    let resourcesDisposed = false;
    let shutdownPromise: Promise<void> | undefined;

    const disposeResources = (): void => {
        if (resourcesDisposed) return;
        resourcesDisposed = true;
        fileWatcherManager.dispose();
        workflowStateStore.dispose();
        database.close();
    };

    const shutdown = (): Promise<void> => {
        if (!shutdownPromise) {
            shutdownPromise = (async (): Promise<void> => {
                try {
                    await pluginLoader.shutdown();
                } finally {
                    disposeResources();
                }
            })();
        }
        return shutdownPromise;
    };

    const commitResolvedProperties = (next: {
        readonly resolved: RegisteredResolvedProperties;
        readonly properties: PropertiesFile;
    }): PropertyApplyResult => {
        const applied: Record<string, unknown> = {};
        const restartRequired: string[] = [];
        const effective: Record<string, unknown> = {};

        for (const descriptor of propertyRegistry.all()) {
            const key = descriptor.key;
            const nextValue = next.resolved[key];
            if (!Object.hasOwn(resolvedProperties, key)) {
                effective[key] = nextValue;
                continue;
            }

            const previousValue = resolvedProperties[key];
            if (propertyValuesEqual(previousValue, nextValue)) {
                effective[key] = previousValue;
                continue;
            }

            if (descriptor.apply === 'hot') {
                effective[key] = nextValue;
                applied[key] = nextValue;
            } else {
                effective[key] = previousValue;
                restartRequired.push(key);
            }
        }

        resolvedProperties = effective as RegisteredResolvedProperties;
        properties = next.properties;
        settings = resolveSettings(resolvedProperties, properties, propertyRegistry);
        fileWatcherManager.setDefaultIgnorePatterns(
            resolvedProperties['file-watcher.ignorePatterns'],
        );

        return { applied, restartRequired };
    };

    const refreshResolvedProperties = (): void => {
        commitResolvedProperties(resolveConfiguredProperties());
    };

    const validateProperties = (
        nextProperties: Readonly<Record<string, unknown>>,
    ): PropertyValidationResult => {
        const result = propertyRegistry.schema().safeParse(nextProperties);
        if (result.success) return { ok: true, properties: result.data };

        const issues = result.error.issues.map((issue) => {
            const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
            return `${path}: ${issue.message}`;
        });
        return {
            ok: false,
            kind: 'validation',
            error: issues.join('\n'),
            issues,
        };
    };

    const applyProperties = (nextProperties: PropertiesFile): PropertyApplyResult => {
        configuredProperties = nextProperties;
        return commitResolvedProperties(resolveConfiguredProperties());
    };

    const updatePluginPermissions = (
        pluginId: string,
        permissions: readonly Capability[],
    ): void => {
        pluginLoader.updatePluginPermissions(pluginId, permissions);
    };

    const registerPermissionTransitionReconciler = (
        reconciler: PermissionTransitionRunReconciler,
    ): (() => void) => {
        const previous = permissionTransitionReconciler;
        permissionTransitionReconciler = reconciler;
        return (): void => {
            if (permissionTransitionReconciler === reconciler) {
                permissionTransitionReconciler = previous;
            }
        };
    };

    const applyPermissionOverride = async (
        pluginId: string,
        overrides: readonly Capability[],
    ): Promise<PermissionOverrideOutcome> =>
        applyPermissionOverrideTransition(
            {
                registry,
                permissionOverrides,
                reconcileActiveWorkflowRuns: permissionTransitionReconciler,
                revokeFileWatcherSubscriptions: (ownerPluginId) =>
                    fileWatcherManager.unregisterSubscribersByOwner(ownerPluginId),
                updatePluginPermissions,
            },
            pluginId,
            overrides,
        );

    return {
        bus,
        bridge,
        capabilityBroker,
        permissionOverrides,
        registry,
        propertyRegistry,
        validateProperties,
        applyProperties,
        workflowStateStore,
        get settings() {
            return settings;
        },
        fileWatcherManager,
        handlerRegistry,
        contractRegistry,
        loadBuiltinPlugins: async (): Promise<readonly NodePluginLoadResult[]> => {
            const kernel = { fileWatcherManager, capabilityBroker };
            const deps = {
                manifestRegistry: registry,
                contractRegistry,
                handlerRegistry,
                kernel,
                bridge,
                permissionOverrides,
                propertyRegistry,
                diagnosticEvent: (event: EngineDiagnosticPayload): void => {
                    bus.next({ name: 'engine.diagnostic', payload: event });
                },
            };
            const builtinResults = await pluginLoader.loadNodePlugins(builtinPluginsDir, {
                ...deps,
                allowExistingPropertyDescriptors: true,
            });
            refreshResolvedProperties();
            return builtinResults;
        },
        applyPermissionOverride,
        registerPermissionTransitionReconciler,
        updatePluginPermissions,
        execute: async (
            pipeline,
            seedContext,
            executionOptions,
        ): Promise<WorkflowExecutionResult> => {
            const topology = acceptWorkflow(pipeline, handlerRegistry, contractRegistry);
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
                { ...executionOptions, contractRegistry },
            );
        },
        shutdown,
        dispose: (): void => {
            void shutdown();
            disposeResources();
        },
    };
}
