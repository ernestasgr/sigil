import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { type PluginId, PluginIdSchema } from '@sigil/contracts/ids';
import type { Capability, Manifest } from '@sigil/contracts/manifest';
import {
    type SerializableNodeContract,
    validatePluginNodeContract,
} from '@sigil/contracts/node-contract';
import type { SerializedPropertyDescriptor } from '@sigil/contracts/properties-file';
import {
    type NodeContractRegistry,
    registerSerializableNodeContract,
} from '@sigil/workflow-domain/node-contract';
import { Either } from 'effect';
import type { EngineDiagnosticPayload } from '../../shared/event-payload-schemas.js';
import type { PropertyRegistry } from '../core/property-registry.js';
import type { Bridge } from '../events/bridge.js';
import type { NodeHandlerRegistry } from '../execution/node-registry.js';
import type { KernelDeps, NodeHandler } from '../node-handlers/types.js';
import { effectiveCapabilityView } from '../persistence/capability-broker.js';
import type { PermissionOverrideStore } from '../persistence/permission-override-store.js';
import type { ManifestRegistry } from './manifest-registry.js';
import {
    type DiscoveredNodePlugin,
    discoverNodePlugin,
    discoverNodePlugins,
    type NodePluginDiscoveryError,
} from './node-plugin-discovery.js';
import { prepareNodePlugin } from './node-plugin-preparation.js';
import {
    createNodePluginWorkerSupervisor,
    type NodePluginWorkerSupervisor,
} from './node-plugin-worker-supervisor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type NodePluginLoadError =
    | NodePluginDiscoveryError
    | {
          readonly kind: 'invalid_handler_module';
          readonly dir: string;
          readonly error: string;
      }
    | {
          readonly kind: 'type_mismatch';
          readonly dir: string;
          readonly manifestType: string;
          readonly descriptorType: string;
      }
    | {
          readonly kind: 'contract_mismatch';
          readonly dir: string;
          readonly pluginId: string;
          readonly nodeType: string;
          readonly error: string;
      }
    | {
          readonly kind: 'duplicate_contract';
          readonly dir: string;
          readonly pluginId: string;
          readonly nodeType: string;
      }
    | { readonly kind: 'duplicate'; readonly dir: string; readonly pluginId: string }
    | { readonly kind: 'duplicate_type'; readonly dir: string; readonly nodeType: string }
    | {
          readonly kind: 'invalid_property_descriptor';
          readonly dir: string;
          readonly key?: string;
          readonly index?: number;
          readonly error: string;
      }
    | {
          readonly kind: 'duplicate_property';
          readonly dir: string;
          readonly key: string;
          readonly index?: number;
      }
    | { readonly kind: 'worker_error'; readonly dir: string; readonly error: string }
    | { readonly kind: 'import_error'; readonly dir: string; readonly error: string };

export type NodePluginLoadResult =
    | {
          readonly ok: true;
          readonly manifest: Manifest;
          readonly descriptor: { readonly type: string };
          readonly contract?: SerializableNodeContract;
          readonly propertyDescriptors: readonly SerializedPropertyDescriptor[];
          readonly handler: NodeHandler;
      }
    | { readonly ok: false; readonly error: NodePluginLoadError };

export interface NodePluginLoaderDeps {
    readonly manifestRegistry: ManifestRegistry;
    readonly contractRegistry?: NodeContractRegistry;
    readonly handlerRegistry: NodeHandlerRegistry;
    readonly kernel?: KernelDeps;
    readonly bridge?: Pick<Bridge, 'emit'>;
    readonly permissionOverrides?: PermissionOverrideStore;
    readonly propertyRegistry?: PropertyRegistry;
    readonly allowExistingPropertyDescriptors?: boolean;
    readonly diagnostic?: (message: string) => void;
    readonly diagnosticEvent?: (event: EngineDiagnosticPayload) => void;
}

export interface NodePluginLoader {
    readonly loadNodePlugin: (
        pluginDir: string,
        deps: NodePluginLoaderDeps,
    ) => Promise<NodePluginLoadResult>;
    readonly loadNodePlugins: (
        pluginsDir: string,
        deps: NodePluginLoaderDeps,
    ) => Promise<readonly NodePluginLoadResult[]>;
    readonly updatePluginPermissions: (
        pluginId: PluginId,
        permissions: readonly Capability[],
    ) => void;
    readonly unloadNodePlugin: (pluginId: PluginId) => Promise<boolean>;
    readonly shutdown: () => Promise<void>;
}

function workerScriptPath(): string {
    const compiledPath = join(__dirname, 'plugin-worker.js');
    return existsSync(compiledPath)
        ? compiledPath
        : join(__dirname, 'plugin-node-worker-bootstrap.mjs');
}

function propertyErrorResult(
    dir: string,
    propertyError: {
        readonly kind: 'invalid' | 'duplicate';
        readonly index: number;
        readonly key?: string;
        readonly message: string;
    },
): NodePluginLoadResult {
    if (propertyError.kind === 'duplicate' && propertyError.key) {
        return {
            ok: false,
            error: {
                kind: 'duplicate_property',
                dir,
                key: propertyError.key,
                index: propertyError.index,
            },
        };
    }
    return {
        ok: false,
        error: {
            kind: 'invalid_property_descriptor',
            dir,
            ...(propertyError.key === undefined ? {} : { key: propertyError.key }),
            index: propertyError.index,
            error: propertyError.message,
        },
    };
}

async function loadDiscoveredPlugin(
    plugin: DiscoveredNodePlugin,
    deps: NodePluginLoaderDeps,
    supervisor: NodePluginWorkerSupervisor,
): Promise<NodePluginLoadResult> {
    const { manifest, dir } = plugin;
    if (manifest.nodeContract !== undefined) {
        const contract = validatePluginNodeContract(
            manifest.nodeContract,
            PluginIdSchema.parse(manifest.id),
            manifest.nodeType,
        );
        if (!contract.ok) {
            return {
                ok: false,
                error: {
                    kind: 'contract_mismatch',
                    dir,
                    pluginId: manifest.id,
                    nodeType: manifest.nodeType,
                    error: contract.error,
                },
            };
        }
    }
    if (deps.manifestRegistry.has(manifest.id)) {
        return { ok: false, error: { kind: 'duplicate', dir, pluginId: manifest.id } };
    }
    if (deps.handlerRegistry.has(manifest.nodeType)) {
        return {
            ok: false,
            error: { kind: 'duplicate_type', dir, nodeType: manifest.nodeType },
        };
    }

    const effectivePermissions = effectiveCapabilityView(
        manifest.permissions,
        deps.permissionOverrides?.has(manifest.id)
            ? deps.permissionOverrides.get(manifest.id)
            : undefined,
    );
    const preparation = prepareNodePlugin(plugin, {
        workerScriptPath: workerScriptPath(),
        permissions: effectivePermissions,
    });

    const loaded = await supervisor.load(preparation, {
        kernel: deps.kernel,
        bridge: deps.bridge,
        diagnostic: deps.diagnostic,
        diagnosticEvent: deps.diagnosticEvent,
    });
    if (!loaded.ok) {
        if (loaded.kind === 'already_loaded') {
            return { ok: false, error: { kind: 'duplicate', dir, pluginId: manifest.id } };
        }
        return loaded.propertyError
            ? propertyErrorResult(dir, loaded.propertyError)
            : loaded.contractError
              ? {
                    ok: false,
                    error: {
                        kind: 'contract_mismatch',
                        dir,
                        pluginId: manifest.id,
                        nodeType: manifest.nodeType,
                        error: loaded.contractError,
                    },
                }
              : { ok: false, error: { kind: 'worker_error', dir, error: loaded.error } };
    }

    const propertyDescriptors = loaded.propertyDescriptors ?? [];
    if (propertyDescriptors.length > 0 && deps.propertyRegistry === undefined) {
        await supervisor.disposePlugin(manifest.id);
        return {
            ok: false,
            error: {
                kind: 'invalid_property_descriptor',
                dir,
                error: 'Plugin properties require a Property registry during loading.',
            },
        };
    }

    const propertyRegistration = deps.propertyRegistry?.registerMany(propertyDescriptors, {
        owner: manifest.id,
        allowExisting: deps.allowExistingPropertyDescriptors,
    });
    const rollbackPropertyRegistration = (): void => {
        if (!propertyRegistration?.ok) return;
        for (const key of propertyRegistration.registeredKeys) {
            deps.propertyRegistry?.unregister(key);
        }
    };
    if (propertyRegistration && !propertyRegistration.ok) {
        await supervisor.disposePlugin(manifest.id);
        if (propertyRegistration.error.kind === 'duplicate') {
            return {
                ok: false,
                error: {
                    kind: 'duplicate_property',
                    dir,
                    key: propertyRegistration.error.key,
                },
            };
        }
        return {
            ok: false,
            error: {
                kind: 'invalid_property_descriptor',
                dir,
                ...(propertyRegistration.error.key === undefined
                    ? {}
                    : { key: propertyRegistration.error.key }),
                error: propertyRegistration.error.message,
            },
        };
    }

    if (manifest.nodeContract !== undefined) {
        if (loaded.contract === undefined) {
            await supervisor.disposePlugin(manifest.id);
            rollbackPropertyRegistration();
            return {
                ok: false,
                error: {
                    kind: 'contract_mismatch',
                    dir,
                    pluginId: manifest.id,
                    nodeType: manifest.nodeType,
                    error: 'Plugin worker did not return the declared Node Contract.',
                },
            };
        }
        if (!isDeepStrictEqual(loaded.contract, manifest.nodeContract)) {
            await supervisor.disposePlugin(manifest.id);
            rollbackPropertyRegistration();
            return {
                ok: false,
                error: {
                    kind: 'contract_mismatch',
                    dir,
                    pluginId: manifest.id,
                    nodeType: manifest.nodeType,
                    error: 'Plugin worker returned a Node Contract different from its manifest.',
                },
            };
        }
    }

    const registerResult = deps.manifestRegistry.register(manifest);
    if (Either.isLeft(registerResult)) {
        await supervisor.disposePlugin(manifest.id);
        rollbackPropertyRegistration();
        return { ok: false, error: { kind: 'duplicate', dir, pluginId: manifest.id } };
    }

    if (manifest.nodeContract !== undefined && deps.contractRegistry !== undefined) {
        if (deps.contractRegistry.has(manifest.nodeContract.identity)) {
            await supervisor.disposePlugin(manifest.id);
            deps.manifestRegistry.unregister(manifest.id);
            rollbackPropertyRegistration();
            return {
                ok: false,
                error: {
                    kind: 'duplicate_contract',
                    dir,
                    pluginId: manifest.id,
                    nodeType: manifest.nodeType,
                },
            };
        }
        try {
            registerSerializableNodeContract(deps.contractRegistry, manifest.nodeContract);
        } catch (error) {
            await supervisor.disposePlugin(manifest.id);
            deps.manifestRegistry.unregister(manifest.id);
            rollbackPropertyRegistration();
            return {
                ok: false,
                error: {
                    kind: 'contract_mismatch',
                    dir,
                    pluginId: manifest.id,
                    nodeType: manifest.nodeType,
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    deps.handlerRegistry.register(manifest.nodeType, loaded.handler);
    return {
        ok: true,
        manifest,
        descriptor: { type: loaded.descriptorType },
        ...(loaded.contract === undefined ? {} : { contract: loaded.contract }),
        propertyDescriptors,
        handler: loaded.handler,
    };
}

async function loadNodePluginWithSupervisor(
    pluginDir: string,
    deps: NodePluginLoaderDeps,
    supervisor: NodePluginWorkerSupervisor,
): Promise<NodePluginLoadResult> {
    const discovered = discoverNodePlugin(pluginDir);
    if (!discovered.ok) return discovered;
    return loadDiscoveredPlugin(discovered.plugin, deps, supervisor);
}

/**
 * Compose discovery, preparation, worker supervision, registry registration,
 * and cleanup behind one loader instance. Worker ownership never escapes this
 * instance.
 */
export function createNodePluginLoader(): NodePluginLoader {
    const supervisor = createNodePluginWorkerSupervisor();
    const loadedPlugins = new Map<
        PluginId,
        {
            readonly nodeType: string;
            readonly contract?: SerializableNodeContract;
            readonly deps: NodePluginLoaderDeps;
        }
    >();

    const loadNodePlugin = async (
        pluginDir: string,
        deps: NodePluginLoaderDeps,
    ): Promise<NodePluginLoadResult> => {
        const result = await loadNodePluginWithSupervisor(pluginDir, deps, supervisor);
        if (result.ok) {
            loadedPlugins.set(result.manifest.id, {
                nodeType: result.manifest.nodeType ?? result.descriptor.type,
                ...(result.contract === undefined ? {} : { contract: result.contract }),
                deps,
            });
        }
        return result;
    };

    const loadNodePlugins = async (
        pluginsDir: string,
        deps: NodePluginLoaderDeps,
    ): Promise<readonly NodePluginLoadResult[]> => {
        const discovered = discoverNodePlugins(pluginsDir);
        const results: NodePluginLoadResult[] = [];
        for (const result of discovered) {
            results.push(result.ok ? await loadNodePlugin(result.plugin.dir, deps) : result);
        }
        return results;
    };

    const unloadNodePlugin = async (pluginId: PluginId): Promise<boolean> => {
        const loaded = loadedPlugins.get(pluginId);
        if (!loaded) return false;

        try {
            await supervisor.disposePlugin(pluginId);
        } finally {
            loaded.deps.propertyRegistry?.unregisterOwner(pluginId);
            loaded.deps.manifestRegistry.unregister(pluginId);
            if (loaded.contract !== undefined) {
                loaded.deps.contractRegistry?.unregister(loaded.contract.identity);
            }
            loaded.deps.handlerRegistry.unregister(loaded.nodeType);
            loadedPlugins.delete(pluginId);
        }
        return true;
    };

    const shutdown = async (): Promise<void> => {
        try {
            await supervisor.shutdown();
        } finally {
            for (const [pluginId, loaded] of loadedPlugins) {
                loaded.deps.propertyRegistry?.unregisterOwner(pluginId);
                loaded.deps.manifestRegistry.unregister(pluginId);
                if (loaded.contract !== undefined) {
                    loaded.deps.contractRegistry?.unregister(loaded.contract.identity);
                }
                loaded.deps.handlerRegistry.unregister(loaded.nodeType);
            }
            loadedPlugins.clear();
        }
    };

    return {
        loadNodePlugin,
        loadNodePlugins,
        updatePluginPermissions: (pluginId, permissions) =>
            supervisor.updatePermissions(pluginId, permissions),
        unloadNodePlugin,
        shutdown,
    };
}
