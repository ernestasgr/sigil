import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capability, Manifest } from '@sigil/schema/manifest';
import type { PropertyRegistry, SerializedPropertyDescriptor } from '@sigil/schema/properties-file';
import { Either } from 'effect';

import type { Bridge } from './bridge.js';
import type { EngineDiagnosticPayload } from './event-payload-schemas.js';
import type { ManifestRegistry } from './manifest-registry.js';
import type { KernelDeps, NodeHandler } from './node-handlers/types.js';
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
import type { NodeHandlerRegistry } from './node-registry.js';
import type { PermissionOverrideStore } from './permission-override-store.js';

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
          readonly propertyDescriptors: readonly SerializedPropertyDescriptor[];
          readonly handler: NodeHandler;
      }
    | { readonly ok: false; readonly error: NodePluginLoadError };

export interface NodePluginLoaderDeps {
    readonly manifestRegistry: ManifestRegistry;
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
        pluginId: string,
        permissions: readonly Capability[],
    ) => void;
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
    if (deps.manifestRegistry.has(manifest.id)) {
        return { ok: false, error: { kind: 'duplicate', dir, pluginId: manifest.id } };
    }
    if (deps.handlerRegistry.has(manifest.nodeType)) {
        return {
            ok: false,
            error: { kind: 'duplicate_type', dir, nodeType: manifest.nodeType },
        };
    }

    const effectivePermissions = deps.permissionOverrides?.has(manifest.id)
        ? deps.permissionOverrides.get(manifest.id)
        : manifest.permissions;
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
        return loaded.propertyError
            ? propertyErrorResult(dir, loaded.propertyError)
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

    const registeredPropertyKeys =
        propertyRegistration?.ok === true ? propertyRegistration.registeredKeys : [];
    const registerResult = deps.manifestRegistry.register(manifest);
    if (Either.isLeft(registerResult)) {
        await supervisor.disposePlugin(manifest.id);
        for (const key of registeredPropertyKeys) {
            deps.propertyRegistry?.unregister(key);
        }
        return { ok: false, error: { kind: 'duplicate', dir, pluginId: manifest.id } };
    }

    deps.handlerRegistry.register(manifest.nodeType, loaded.handler);
    return {
        ok: true,
        manifest,
        descriptor: { type: loaded.descriptorType },
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

async function loadNodePluginsWithSupervisor(
    pluginsDir: string,
    deps: NodePluginLoaderDeps,
    supervisor: NodePluginWorkerSupervisor,
): Promise<readonly NodePluginLoadResult[]> {
    const discovered = discoverNodePlugins(pluginsDir);
    const results: NodePluginLoadResult[] = [];
    for (const result of discovered) {
        results.push(
            result.ok ? await loadDiscoveredPlugin(result.plugin, deps, supervisor) : result,
        );
    }
    return results;
}

/**
 * Compose discovery, preparation, worker supervision, registry registration,
 * and cleanup behind one loader instance. Worker ownership never escapes this
 * instance.
 */
export function createNodePluginLoader(): NodePluginLoader {
    const supervisor = createNodePluginWorkerSupervisor();
    return {
        loadNodePlugin: (pluginDir, deps) =>
            loadNodePluginWithSupervisor(pluginDir, deps, supervisor),
        loadNodePlugins: (pluginsDir, deps) =>
            loadNodePluginsWithSupervisor(pluginsDir, deps, supervisor),
        updatePluginPermissions: (pluginId, permissions) =>
            supervisor.updatePermissions(pluginId, permissions),
        shutdown: () => supervisor.shutdown(),
    };
}

/** Compatibility facade for callers that only need one load operation. */
export async function loadNodePlugin(
    pluginDir: string,
    deps: NodePluginLoaderDeps,
): Promise<NodePluginLoadResult> {
    const loader = createNodePluginLoader();
    return loader.loadNodePlugin(pluginDir, deps);
}

/** Compatibility facade for callers that only need one directory load. */
export async function loadNodePlugins(
    pluginsDir: string,
    deps: NodePluginLoaderDeps,
): Promise<readonly NodePluginLoadResult[]> {
    const loader = createNodePluginLoader();
    return loader.loadNodePlugins(pluginsDir, deps);
}
