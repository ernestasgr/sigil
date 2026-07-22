import type { Capability } from '@sigil/schema/manifest';
import type { SerializableNodeContract } from '@sigil/schema/node-contract';

import type { DiscoveredNodePlugin } from './node-plugin-discovery.js';

export interface NodePluginPreparation {
    readonly dir: string;
    readonly pluginId: string;
    readonly manifestNodeType: string;
    readonly nodeContract?: SerializableNodeContract;
    readonly handlerPath: string;
    readonly manifestPermissions: readonly Capability[];
    readonly permissions: readonly Capability[];
    readonly workerScriptPath: string;
}

export interface NodePluginPreparationOptions {
    readonly workerScriptPath: string;
    readonly permissions?: readonly Capability[];
}

/**
 * Convert a discovered declaration into immutable worker input. Preparation
 * performs no registry writes and never creates a worker.
 */
export function prepareNodePlugin(
    plugin: DiscoveredNodePlugin,
    options: NodePluginPreparationOptions,
): NodePluginPreparation {
    return {
        dir: plugin.dir,
        pluginId: plugin.manifest.id,
        manifestNodeType: plugin.manifest.nodeType,
        ...(plugin.manifest.nodeContract === undefined
            ? {}
            : { nodeContract: structuredClone(plugin.manifest.nodeContract) }),
        handlerPath: plugin.handlerPath,
        manifestPermissions: [...plugin.manifest.permissions],
        permissions: [...(options.permissions ?? plugin.manifest.permissions)],
        workerScriptPath: options.workerScriptPath,
    };
}
