import { getNodeDescriptor, type NodeType } from '@sigil/schema/nodes';
import { switchPortLabel } from '@sigil/schema/nodes/switch';

import {
    type BuiltinNodeSpec,
    createNodeConfigForm,
    isPluginNodeSpec,
    type NodeCategory,
    type NodeConfigForm,
    type NodeSpec,
    nodeTypeDef,
    type PluginNodeSpec,
} from './node-registry.js';

export type NodeConfigValidation =
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: string };

export interface PluginNodeCatalogEntry {
    readonly source: 'plugin';
    readonly pluginId: string;
    readonly type: string;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly defaultConfig: unknown;
    readonly isTrigger: boolean;
    readonly outputPorts: (config: unknown) => readonly string[] | 'dynamic';
    readonly validateConfig: (config: unknown) => NodeConfigValidation;
    readonly Form?: NodeConfigForm;
}

export interface ResolvedNodeCatalogEntry {
    readonly source: 'builtin' | 'plugin';
    readonly type: string;
    readonly pluginId?: string;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly defaultConfig: unknown;
    readonly authoring: 'editable' | 'read-only';
    readonly isTrigger: boolean | 'unknown';
    readonly outputPorts: readonly string[] | 'dynamic';
    readonly validateConfig?: (config: unknown) => NodeConfigValidation;
    readonly Form?: NodeConfigForm;
    readonly readOnlyReason?: string;
}

export interface NodeCatalog {
    readonly entries: readonly PluginNodeCatalogEntry[];
    readonly find: (pluginId: string, type: string) => PluginNodeCatalogEntry | undefined;
}

function pluginKey(pluginId: string, type: string): string {
    return `${pluginId}\u0000${type}`;
}

function builtinOutputPorts(spec: BuiltinNodeSpec): readonly string[] {
    switch (spec.type) {
        case 'file-watcher':
            return getNodeDescriptor('file-watcher').getOutputPorts(spec.config);
        case 'manual-trigger':
            return getNodeDescriptor('manual-trigger').getOutputPorts(spec.config);
        case 'if-else':
            return getNodeDescriptor('if-else').getOutputPorts(spec.config);
        case 'switch':
            return getNodeDescriptor('switch').getOutputPorts(spec.config);
        case 'file-manager':
            return getNodeDescriptor('file-manager').getOutputPorts(spec.config);
        case 'notification':
            return getNodeDescriptor('notification').getOutputPorts(spec.config);
        case 'log':
            return getNodeDescriptor('log').getOutputPorts(spec.config);
        case 'delay':
            return getNodeDescriptor('delay').getOutputPorts(spec.config);
        case 'state-get':
            return getNodeDescriptor('state-get').getOutputPorts(spec.config);
        case 'state-set':
            return getNodeDescriptor('state-set').getOutputPorts(spec.config);
    }
}

function builtinPortLabel(spec: BuiltinNodeSpec, port: string): string {
    if (spec.type === 'switch') return switchPortLabel(spec.config, port);
    return port;
}

function builtinPluginAdapter<K extends NodeType>(
    pluginId: string,
    type: K,
    isTrigger: boolean,
): PluginNodeCatalogEntry {
    const definition = nodeTypeDef(type);
    const descriptor = getNodeDescriptor(type);
    return {
        source: 'plugin',
        pluginId,
        type,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        defaultConfig: definition.defaultConfig,
        isTrigger,
        outputPorts: () => ['out'],
        validateConfig: (config) => {
            const parsed = descriptor.configSchema.safeParse(config);
            return parsed.success
                ? { ok: true, value: parsed.data }
                : { ok: false, error: parsed.error.message };
        },
        Form: createNodeConfigForm(type),
    };
}

export const BUILTIN_PLUGIN_NODE_CATALOG: readonly PluginNodeCatalogEntry[] = [
    builtinPluginAdapter('com.sigil.file-watcher', 'file-watcher', true),
    builtinPluginAdapter('com.sigil.file-manager', 'file-manager', false),
];

export function createNodeCatalog(
    additionalEntries: readonly PluginNodeCatalogEntry[] = [],
): NodeCatalog {
    const entries = new Map<string, PluginNodeCatalogEntry>();
    for (const entry of [...BUILTIN_PLUGIN_NODE_CATALOG, ...additionalEntries]) {
        const key = pluginKey(entry.pluginId, entry.type);
        if (!entries.has(key)) entries.set(key, entry);
    }

    const frozenEntries = Object.freeze([...entries.values()]);
    return {
        entries: frozenEntries,
        find: (pluginId, type) => entries.get(pluginKey(pluginId, type)),
    };
}

export const DEFAULT_NODE_CATALOG = createNodeCatalog();

function unsupportedPluginEntry(spec: PluginNodeSpec): ResolvedNodeCatalogEntry {
    const readOnlyReason =
        `Plugin Node "${spec.type}" from "${spec.pluginId}" has no Workflow Builder ` +
        'authoring adapter; it is read-only and its identity and configuration will be preserved.';
    return {
        source: 'plugin',
        type: spec.type,
        pluginId: spec.pluginId,
        label: `Plugin Node · ${spec.type}`,
        category: 'utility',
        description: readOnlyReason,
        defaultConfig: undefined,
        authoring: 'read-only',
        isTrigger: 'unknown',
        outputPorts: 'dynamic',
        readOnlyReason,
    };
}

function resolvePluginNode(spec: PluginNodeSpec, catalog: NodeCatalog): ResolvedNodeCatalogEntry {
    const entry = catalog.find(spec.pluginId, spec.type);
    if (!entry) return unsupportedPluginEntry(spec);

    const validation = entry.validateConfig(spec.config);
    const authoring = entry.Form ? 'editable' : 'read-only';
    const readOnlyReason = entry.Form
        ? undefined
        : `Plugin Node "${spec.type}" from "${spec.pluginId}" has no config editor and is read-only.`;

    return {
        source: 'plugin',
        type: entry.type,
        pluginId: entry.pluginId,
        label: entry.label,
        category: entry.category,
        description: entry.description,
        defaultConfig: entry.defaultConfig,
        authoring,
        isTrigger: entry.isTrigger,
        outputPorts: validation.ok ? entry.outputPorts(spec.config) : 'dynamic',
        validateConfig: entry.validateConfig,
        ...(entry.Form ? { Form: entry.Form } : {}),
        ...(readOnlyReason ? { readOnlyReason } : {}),
    };
}

export function resolveNodeCatalogEntry(
    spec: NodeSpec,
    catalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): ResolvedNodeCatalogEntry {
    if (isPluginNodeSpec(spec)) return resolvePluginNode(spec, catalog);

    const definition = nodeTypeDef(spec.type);
    return {
        source: 'builtin',
        type: definition.type,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        defaultConfig: definition.defaultConfig,
        authoring: 'editable',
        isTrigger: spec.type === 'manual-trigger' || spec.type === 'file-watcher',
        outputPorts: builtinOutputPorts(spec),
    };
}

export function nodeOutputPorts(
    spec: NodeSpec,
    catalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): readonly string[] | 'dynamic' {
    return resolveNodeCatalogEntry(spec, catalog).outputPorts;
}

export function nodeOutputPortLabel(
    spec: NodeSpec,
    port: string,
    catalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): string {
    if (isPluginNodeSpec(spec)) return port;
    resolveNodeCatalogEntry(spec, catalog);
    return builtinPortLabel(spec, port);
}
