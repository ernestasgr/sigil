import type { Manifest } from '@sigil/schema/manifest';
import {
    BUILTIN_NODE_CONTRACT_REGISTRY,
    createBuiltinNodeContractRegistry,
    getBuiltinNodeContract,
    type NodeContractRegistry,
    pluginNodeIdentity,
    registerSerializableNodeContract,
    resolveNodeContract,
    type SerializableNodeContractInput,
} from '@sigil/schema/node-contract';
import {
    type BuiltinPipelineNode,
    getNodeDescriptor,
    isPluginNode,
    type NodeDescriptor,
    type NodeType,
    type PipelineNode,
} from '@sigil/schema/nodes';
import { type ComponentType, createElement, type ReactElement } from 'react';
import type { z } from 'zod';

import type { ConfigFormProps } from './inspector/config-forms.js';
import {
    DelayConfigForm,
    FileManagerConfigForm,
    FileWatcherConfigForm,
    IfElseConfigForm,
    LogConfigForm,
    ManualTriggerConfigForm,
    NotificationConfigForm,
    StateGetConfigForm,
    StateSetConfigForm,
    SwitchConfigForm,
} from './inspector/config-forms.js';

export type { NodeType } from '@sigil/schema/nodes';

export type NodeCategory = 'trigger' | 'logic' | 'system' | 'state' | 'utility';

export type NodeConfigForm = (props: ConfigFormProps<unknown>) => ReactElement;

export type NodeConfigValidation<TValue = unknown> =
    | { readonly ok: true; readonly value: TValue }
    | { readonly ok: false; readonly error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type BuiltinNodeSpec = DistributiveOmit<BuiltinPipelineNode, 'id'>;

export interface PluginNodeSpec {
    readonly type: string;
    readonly pluginId: string;
    readonly config: unknown;
}

export type NodeSpec = BuiltinNodeSpec | PluginNodeSpec;

export type BuilderNodeSpec = NodeSpec & Record<string, unknown>;

export function isPluginNodeSpec(spec: NodeSpec): spec is PluginNodeSpec {
    return 'pluginId' in spec;
}

export function nodeSpecData(spec: NodeSpec): BuilderNodeSpec {
    if (isPluginNodeSpec(spec)) {
        return {
            type: spec.type,
            pluginId: spec.pluginId,
            config: structuredClone(spec.config),
        };
    }
    return structuredClone(spec);
}

interface NodeCatalogEntryFields {
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly defaultConfig: unknown;
    readonly isTrigger: boolean;
    readonly validateConfig: (config: unknown) => NodeConfigValidation;
    readonly outputPorts: (config: unknown) => readonly string[] | 'dynamic';
    readonly outputPortLabel?: (config: unknown, port: string) => string;
    readonly showInPalette?: boolean;
    readonly authoring?: 'editable' | 'read-only';
    readonly Form?: NodeConfigForm;
}

export interface BuiltinNodeCatalogEntry extends NodeCatalogEntryFields {
    readonly source: 'builtin';
    readonly type: NodeType;
    readonly pluginId?: never;
    readonly Form: NodeConfigForm;
    readonly authoring: 'editable';
    readonly outputPortLabel: (config: unknown, port: string) => string;
    readonly showInPalette: true;
}

export interface PluginNodeCatalogEntry extends NodeCatalogEntryFields {
    readonly source: 'plugin';
    readonly type: string;
    readonly pluginId: string;
}

export type NodeCatalogEntry = BuiltinNodeCatalogEntry | PluginNodeCatalogEntry;

export interface PluginNodeCatalogAdapter<TConfig = unknown> {
    readonly pluginId: string;
    readonly type: string;
    /** Authoring presentation may refine the contract display facts. */
    readonly label?: string;
    readonly category?: NodeCategory;
    readonly description?: string;
    /** Authoring defaults win when supplied; the contract default is the fallback. */
    readonly defaultConfig?: TConfig;
    readonly configSchema?: z.ZodType<TConfig>;
    /** @deprecated Contract role is authoritative when a snapshot is loaded. */
    readonly isTrigger?: boolean;
    /** @deprecated Contract output ports are authoritative when a snapshot is loaded. */
    readonly outputPorts?: (config: TConfig) => readonly string[] | 'dynamic';
    readonly outputPortLabel?: (config: TConfig, port: string) => string;
    readonly showInPalette?: boolean;
    readonly Form?: ComponentType<ConfigFormProps<TConfig>>;
}

export type NodeCatalogManifest = Pick<Manifest, 'id' | 'nodeType'> & {
    readonly nodeContract?: SerializableNodeContractInput;
};

interface BuiltinNodeCatalogAdapter<K extends NodeType, TSchema extends z.ZodType> {
    readonly descriptor: NodeDescriptor<K, TSchema>;
    readonly Form: ComponentType<ConfigFormProps<z.output<TSchema>>>;
}

function validateConfig<TSchema extends z.ZodType>(
    configSchema: TSchema,
    config: unknown,
): NodeConfigValidation<z.output<TSchema>> {
    const parsed = configSchema.safeParse(config);
    return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, error: parsed.error.message };
}

function outputPortsForConfig<TSchema extends z.ZodType>(
    configSchema: TSchema,
    outputPorts: (config: z.output<TSchema>) => readonly string[] | 'dynamic',
    config: unknown,
): readonly string[] | 'dynamic' {
    const validation = validateConfig(configSchema, config);
    return validation.ok ? outputPorts(validation.value) : 'dynamic';
}

function builtinOutputPorts(
    type: NodeType,
    config: unknown,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): readonly string[] | 'dynamic' {
    const resolved = resolveNodeContract({ type, config }, registry);
    if (resolved.status !== 'available') return 'dynamic';
    return resolved.outputPorts === 'dynamic'
        ? 'dynamic'
        : resolved.outputPorts.map((port) => port.id);
}

function builtinOutputPortLabel(
    type: NodeType,
    config: unknown,
    port: string,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): string {
    const resolved = resolveNodeContract({ type, config }, registry);
    if (resolved.status !== 'available' || resolved.outputPorts === 'dynamic') return port;
    return resolved.outputPorts.find((candidate) => candidate.id === port)?.label ?? port;
}

export function createNodeConfigForm<TSchema extends z.ZodType>(
    type: string,
    Form: ComponentType<ConfigFormProps<z.output<TSchema>>>,
    configSchema: TSchema,
): NodeConfigForm {
    return ({ config, onChange, eventCatalog }) => {
        const parsed = configSchema.safeParse(config);
        if (!parsed.success) {
            return createElement(
                'p',
                {
                    role: 'alert',
                    className: 'text-old-blood-foreground font-data text-[10px]',
                },
                `Node "${type}" has invalid configuration: ${parsed.error.message}`,
            );
        }

        return createElement(Form, {
            config: parsed.data,
            onChange: (next: z.output<TSchema>) => onChange(next),
            eventCatalog,
        });
    };
}

function createBuiltinNodeCatalogEntry<K extends NodeType, TSchema extends z.ZodType>(
    adapter: BuiltinNodeCatalogAdapter<K, TSchema>,
): BuiltinNodeCatalogEntry {
    const descriptor = adapter.descriptor;
    const contract = getBuiltinNodeContract(descriptor.type);
    return {
        source: 'builtin',
        type: descriptor.type,
        label: contract.display.label,
        category: contract.display.category,
        description: contract.display.description,
        defaultConfig: contract.defaultConfig,
        isTrigger: contract.role === 'trigger',
        validateConfig: (config) => validateConfig(descriptor.configSchema, config),
        outputPorts: (config) => builtinOutputPorts(descriptor.type, config),
        outputPortLabel: (config, port) => builtinOutputPortLabel(descriptor.type, config, port),
        showInPalette: true,
        authoring: 'editable',
        Form: createNodeConfigForm(descriptor.type, adapter.Form, descriptor.configSchema),
    };
}

export function createPluginNodeCatalogEntry<TConfig>(
    adapter: PluginNodeCatalogAdapter<TConfig>,
): PluginNodeCatalogEntry {
    const configSchema = adapter.configSchema;
    const outputPorts = adapter.outputPorts;
    const outputPortLabel = adapter.outputPortLabel;
    const Form =
        adapter.Form && configSchema
            ? createNodeConfigForm(adapter.type, adapter.Form, configSchema)
            : undefined;
    return {
        source: 'plugin',
        pluginId: adapter.pluginId,
        type: adapter.type,
        label: adapter.label ?? adapter.type,
        category: adapter.category ?? 'utility',
        description: adapter.description ?? `Plugin Node ${adapter.type}.`,
        defaultConfig: adapter.defaultConfig,
        isTrigger: adapter.isTrigger ?? false,
        validateConfig: configSchema
            ? (config) => validateConfig(configSchema, config)
            : (config) => ({ ok: true, value: config }),
        outputPorts:
            configSchema && outputPorts
                ? (config) => outputPortsForConfig(configSchema, outputPorts, config)
                : () => 'dynamic',
        ...(configSchema && outputPortLabel
            ? {
                  outputPortLabel: (config: unknown, port: string): string => {
                      const parsed = configSchema.safeParse(config);
                      return parsed?.success
                          ? (outputPortLabel?.(parsed.data, port) ?? port)
                          : port;
                  },
              }
            : {}),
        showInPalette: adapter.showInPalette ?? true,
        authoring: Form ? 'editable' : 'read-only',
        ...(Form ? { Form } : {}),
    };
}

const BUILTIN_NODE_CATALOG_ENTRIES: readonly BuiltinNodeCatalogEntry[] = [
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('file-watcher'),
        Form: FileWatcherConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('manual-trigger'),
        Form: ManualTriggerConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('if-else'),
        Form: IfElseConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('switch'),
        Form: SwitchConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('file-manager'),
        Form: FileManagerConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('notification'),
        Form: NotificationConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('state-get'),
        Form: StateGetConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('state-set'),
        Form: StateSetConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('log'),
        Form: LogConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('delay'),
        Form: DelayConfigForm,
    }),
];

export const BUILTIN_NODE_CATALOG: readonly BuiltinNodeCatalogEntry[] =
    BUILTIN_NODE_CATALOG_ENTRIES;

function pluginEntryFromBuiltin(pluginId: string, type: NodeType): PluginNodeCatalogEntry {
    const builtin = BUILTIN_NODE_CATALOG.find((entry) => entry.type === type);
    if (!builtin) throw new Error(`Missing built-in Node catalog entry for "${type}"`);

    return {
        source: 'plugin',
        pluginId,
        type: builtin.type,
        label: builtin.label,
        category: builtin.category,
        description: builtin.description,
        defaultConfig: builtin.defaultConfig,
        isTrigger: builtin.isTrigger,
        validateConfig: builtin.validateConfig,
        outputPorts: builtin.outputPorts,
        outputPortLabel: builtin.outputPortLabel,
        showInPalette: false,
        authoring: 'editable',
        Form: builtin.Form,
    };
}

export const BUILTIN_PLUGIN_NODE_CATALOG: readonly PluginNodeCatalogEntry[] = [
    pluginEntryFromBuiltin('com.sigil.file-watcher', 'file-watcher'),
    pluginEntryFromBuiltin('com.sigil.file-manager', 'file-manager'),
];

function pluginKey(pluginId: string, type: string): string {
    return `${pluginId}\u0000${type}`;
}

export interface NodeCatalog {
    readonly entries: readonly NodeCatalogEntry[];
    readonly contractRegistry: NodeContractRegistry;
    readonly findBuiltin: (type: NodeType) => BuiltinNodeCatalogEntry | undefined;
    readonly findPlugin: (pluginId: string, type: string) => PluginNodeCatalogEntry | undefined;
    readonly findForSpec: (spec: NodeSpec) => NodeCatalogEntry | undefined;
    /** Compatibility lookup for callers that already know a Plugin identity. */
    readonly find: (pluginId: string, type: string) => PluginNodeCatalogEntry | undefined;
}

export interface NodeCatalogOptions {
    readonly includeBundledPluginEntries?: boolean;
    readonly contractRegistry?: NodeContractRegistry;
    readonly includeContractEntries?: boolean;
}

export function createNodeCatalog(
    additionalEntries: readonly PluginNodeCatalogEntry[] = [],
    options: NodeCatalogOptions = {},
): NodeCatalog {
    const contractRegistry = options.contractRegistry ?? BUILTIN_NODE_CONTRACT_REGISTRY;
    const builtinEntries = new Map<NodeType, BuiltinNodeCatalogEntry>();
    for (const entry of BUILTIN_NODE_CATALOG) builtinEntries.set(entry.type, entry);

    const pluginEntries = new Map<string, PluginNodeCatalogEntry>();
    const bundledPluginEntries =
        options.includeBundledPluginEntries === false ? [] : BUILTIN_PLUGIN_NODE_CATALOG;
    for (const entry of [...bundledPluginEntries, ...additionalEntries]) {
        const key = pluginKey(entry.pluginId, entry.type);
        if (!pluginEntries.has(key)) {
            pluginEntries.set(key, normalizePluginEntry(entry, contractRegistry));
        }
    }

    if (options.includeContractEntries !== false) {
        for (const contract of contractRegistry.all()) {
            if (contract.identity.namespace !== 'plugin') continue;
            const key = pluginKey(contract.identity.pluginId, contract.identity.type);
            if (!pluginEntries.has(key)) {
                pluginEntries.set(key, pluginEntryFromContract(contract, contractRegistry));
            }
        }
    }

    const entries = Object.freeze([
        ...builtinEntries.values(),
        ...pluginEntries.values(),
    ] as NodeCatalogEntry[]);
    const findPlugin = (pluginId: string, type: string): PluginNodeCatalogEntry | undefined =>
        pluginEntries.get(pluginKey(pluginId, type));

    return {
        entries,
        contractRegistry,
        findBuiltin: (type) => builtinEntries.get(type),
        findPlugin,
        findForSpec: (spec) =>
            isPluginNodeSpec(spec)
                ? findPlugin(spec.pluginId, spec.type)
                : builtinEntries.get(spec.type),
        find: findPlugin,
    };
}

export function createNodeCatalogFromManifests(
    manifests: readonly NodeCatalogManifest[],
    adapters: readonly PluginNodeCatalogEntry[] = BUILTIN_PLUGIN_NODE_CATALOG,
): NodeCatalog {
    const contractRegistry = createBuiltinNodeContractRegistry();
    for (const manifest of manifests) {
        if (manifest.nodeType === undefined || manifest.nodeContract === undefined) continue;
        const identity = manifest.nodeContract.identity;
        if (
            identity.namespace !== 'plugin' ||
            identity.pluginId !== manifest.id ||
            identity.type !== manifest.nodeType
        ) {
            continue;
        }
        registerSerializableNodeContract(contractRegistry, manifest.nodeContract);
    }
    const entries = adapters.filter((entry) =>
        manifests.some(
            (manifest) => manifest.id === entry.pluginId && manifest.nodeType === entry.type,
        ),
    );
    return createNodeCatalog(entries, {
        includeBundledPluginEntries: false,
        contractRegistry,
    });
}

function normalizePluginEntry(
    entry: PluginNodeCatalogEntry,
    registry: NodeContractRegistry,
): PluginNodeCatalogEntry {
    const contract = registry.get(pluginNodeIdentity(entry.pluginId, entry.type));
    if (!contract) {
        return {
            ...entry,
            isTrigger: false,
            outputPorts: () => [],
            outputPortLabel: entry.outputPortLabel ?? ((_config, port) => port),
            showInPalette: false,
            authoring: 'read-only',
        };
    }

    return {
        ...entry,
        defaultConfig:
            entry.defaultConfig === undefined ? contract.defaultConfig : entry.defaultConfig,
        isTrigger: contract.role === 'trigger',
        outputPorts: (config) => {
            const resolved = resolveNodeContract(
                { type: entry.type, pluginId: entry.pluginId, config },
                registry,
            );
            if (resolved.status !== 'available') return 'dynamic';
            return resolved.outputPorts === 'dynamic'
                ? 'dynamic'
                : resolved.outputPorts.map((port) => port.id);
        },
        outputPortLabel: (config, port) => {
            const resolved = resolveNodeContract(
                { type: entry.type, pluginId: entry.pluginId, config },
                registry,
            );
            if (resolved.status !== 'available' || resolved.outputPorts === 'dynamic') return port;
            return resolved.outputPorts.find((candidate) => candidate.id === port)?.label ?? port;
        },
        showInPalette: entry.showInPalette ?? true,
        authoring: entry.authoring ?? (entry.Form ? 'editable' : 'read-only'),
    };
}

function pluginEntryFromContract(
    contract: SerializableNodeContractInput,
    registry: NodeContractRegistry,
): PluginNodeCatalogEntry {
    if (contract.identity.namespace !== 'plugin') {
        throw new Error('Only Plugin Node Contracts can create Plugin catalog entries.');
    }
    const { pluginId, type } = contract.identity;

    return {
        source: 'plugin',
        pluginId,
        type,
        label: contract.display.label,
        category: contract.display.category,
        description: contract.display.description,
        defaultConfig: contract.defaultConfig,
        isTrigger: contract.role === 'trigger',
        validateConfig: (config) => ({ ok: true, value: config }),
        outputPorts: (config) => {
            const resolved = resolveNodeContract(
                {
                    type,
                    pluginId,
                    config,
                },
                registry,
            );
            if (resolved.status !== 'available') return 'dynamic';
            return resolved.outputPorts === 'dynamic'
                ? 'dynamic'
                : resolved.outputPorts.map((port) => port.id);
        },
        outputPortLabel: (config, port) => {
            const resolved = resolveNodeContract(
                {
                    type,
                    pluginId,
                    config,
                },
                registry,
            );
            if (resolved.status !== 'available' || resolved.outputPorts === 'dynamic') return port;
            return resolved.outputPorts.find((candidate) => candidate.id === port)?.label ?? port;
        },
        showInPalette: false,
        authoring: 'read-only',
    };
}

export const DEFAULT_NODE_CATALOG = createNodeCatalog();

function unsupportedPluginEntry(spec: PluginNodeSpec): ResolvedNodeCatalogEntry {
    const readOnlyReason =
        `Plugin Node "${spec.type}" from "${spec.pluginId}" has no registered Node Contract or ` +
        'Workflow Builder authoring adapter; it is read-only and its identity and configuration will be preserved.';
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
        outputPorts: [],
        outputPortLabel: (_config, port) => port,
        contractStatus: 'unavailable',
        readOnlyReason,
    };
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
    readonly contractStatus: 'available' | 'invalid' | 'unavailable';
    readonly isTrigger: boolean | 'unknown';
    readonly outputPorts: readonly string[] | 'dynamic';
    readonly outputPortLabel: (config: unknown, port: string) => string;
    readonly validateConfig?: (config: unknown) => NodeConfigValidation;
    readonly Form?: NodeConfigForm;
    readonly readOnlyReason?: string;
}

export function resolveNodeCatalogEntry(
    spec: NodeSpec,
    catalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): ResolvedNodeCatalogEntry {
    const entry = catalog.findForSpec(spec);
    if (!entry) {
        if (isPluginNodeSpec(spec)) return unsupportedPluginEntry(spec);
        throw new Error(`Missing built-in Node catalog entry for "${spec.type}"`);
    }

    const contractResolution = resolveNodeContract(
        {
            type: spec.type,
            ...(isPluginNodeSpec(spec) ? { pluginId: spec.pluginId } : {}),
            config: spec.config,
        },
        catalog.contractRegistry,
    );
    const authoring =
        contractResolution.status === 'unavailable'
            ? 'read-only'
            : (entry.authoring ?? (entry.Form ? 'editable' : 'read-only'));
    const readOnlyReason =
        entry.source !== 'plugin'
            ? undefined
            : contractResolution.status === 'unavailable'
              ? `Plugin Node "${spec.type}" from "${entry.pluginId}" has no registered Node Contract; its identity and configuration are preserved read-only.`
              : !entry.Form
                ? `Plugin Node "${spec.type}" from "${entry.pluginId}" has no config editor and is read-only.`
                : undefined;

    return {
        source: entry.source,
        type: entry.type,
        ...(entry.pluginId ? { pluginId: entry.pluginId } : {}),
        label: entry.label,
        category: entry.category,
        description: entry.description,
        defaultConfig: entry.defaultConfig,
        authoring,
        contractStatus: contractResolution.status,
        isTrigger:
            contractResolution.status === 'available'
                ? contractResolution.contract.role === 'trigger'
                : contractResolution.status === 'invalid'
                  ? contractResolution.contract.role === 'trigger'
                  : 'unknown',
        outputPorts:
            contractResolution.status === 'available'
                ? contractResolution.outputPorts === 'dynamic'
                    ? 'dynamic'
                    : contractResolution.outputPorts.map((port) => port.id)
                : contractResolution.status === 'invalid'
                  ? contractResolution.outputPorts === undefined
                      ? []
                      : contractResolution.outputPorts === 'dynamic'
                        ? 'dynamic'
                        : contractResolution.outputPorts.map((port) => port.id)
                  : [],
        outputPortLabel: (config, port) => {
            const parsed = entry.validateConfig(config);
            if (!parsed.ok) return port;

            const resolved = resolveNodeContract(
                {
                    type: spec.type,
                    ...(isPluginNodeSpec(spec) ? { pluginId: spec.pluginId } : {}),
                    config: parsed.value,
                },
                catalog.contractRegistry,
            );
            if (resolved.status === 'unavailable' || resolved.outputPorts === undefined) {
                return port;
            }
            if (resolved.outputPorts === 'dynamic') return port;
            return resolved.outputPorts.find((candidate) => candidate.id === port)?.label ?? port;
        },
        validateConfig: entry.validateConfig,
        ...(entry.Form ? { Form: entry.Form } : {}),
        ...(readOnlyReason ? { readOnlyReason } : {}),
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
    const entry = resolveNodeCatalogEntry(spec, catalog);
    return entry.outputPortLabel(spec.config, port);
}

export function defaultNodeSpecForCatalogEntry(entry: NodeCatalogEntry): BuilderNodeSpec {
    if (entry.source === 'plugin') {
        return nodeSpecData({
            type: entry.type,
            pluginId: entry.pluginId,
            config: structuredClone(entry.defaultConfig),
        });
    }

    // The entry's validator is created from the descriptor that owns this
    // default. The renderer seam intentionally erases that generic relation.
    return nodeSpecData({
        type: entry.type,
        config: structuredClone(entry.defaultConfig),
    } as NodeSpec);
}

export function defaultNodeSpec(type: NodeType): BuilderNodeSpec {
    const entry = DEFAULT_NODE_CATALOG.findBuiltin(type);
    if (!entry) throw new Error(`Missing built-in Node catalog entry for "${type}"`);
    return defaultNodeSpecForCatalogEntry(entry);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializeNodeCatalogEntry(entry: NodeCatalogEntry): string {
    return JSON.stringify({
        type: entry.type,
        ...(entry.source === 'plugin' ? { pluginId: entry.pluginId } : {}),
    });
}

export function nodeCatalogEntryFromPaletteValue(
    value: string,
    catalog: NodeCatalog = DEFAULT_NODE_CATALOG,
): NodeCatalogEntry | undefined {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;

        if (typeof parsed.pluginId === 'string') {
            return catalog.findPlugin(parsed.pluginId, parsed.type);
        }
        if (!isNodeType(parsed.type)) return undefined;
        return catalog.findBuiltin(parsed.type);
    } catch {
        if (!isNodeType(value)) return undefined;
        return catalog.findBuiltin(value);
    }
}

export function nodeSpecWithConfig(spec: NodeSpec, config: unknown): NodeSpec {
    if (isPluginNodeSpec(spec)) {
        return { type: spec.type, pluginId: spec.pluginId, config };
    }

    // ConfigForm has already crossed the catalog validator before this helper
    // is called. The assertion restores the descriptor/config correlation that
    // is intentionally hidden from generic renderer consumers.
    return { type: spec.type, config } as NodeSpec;
}

export type NodeTypeDef = BuiltinNodeCatalogEntry;

export function nodeTypeDef(type: NodeType): NodeTypeDef {
    const entry = DEFAULT_NODE_CATALOG.findBuiltin(type);
    if (!entry) throw new Error(`Missing built-in Node catalog entry for "${type}"`);
    return entry;
}

export const NODE_TYPES: readonly NodeTypeDef[] = BUILTIN_NODE_CATALOG;

export function isNodeType(value: unknown): value is NodeType {
    return typeof value === 'string' && BUILTIN_NODE_CATALOG.some((entry) => entry.type === value);
}

export interface CategoryMeta {
    readonly id: NodeCategory;
    readonly label: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
    { id: 'trigger', label: 'Triggers' },
    { id: 'logic', label: 'Logic' },
    { id: 'system', label: 'System' },
    { id: 'state', label: 'State' },
    { id: 'utility', label: 'Utility' },
];

export const CATEGORY_TOP_ACCENT: Readonly<Record<NodeCategory, string>> = {
    trigger: 'border-t-[3px] border-t-trigger',
    logic: 'border-t-[3px] border-t-logic',
    system: 'border-t-[3px] border-t-system',
    state: 'border-t-[3px] border-t-state',
    utility: 'border-t-[3px] border-t-utility',
};

// Fill (not border) version of the category accent, for surfaces that clip
// their own corners — a `border-t` doesn't follow a diagonal clip-path, but
// a background does. See pipeline-node-card.tsx.
export const CATEGORY_ACCENT_BG: Readonly<Record<NodeCategory, string>> = {
    trigger: 'bg-trigger',
    logic: 'bg-logic',
    system: 'bg-system',
    state: 'bg-state',
    utility: 'bg-utility',
};

export const CATEGORY_TEXT: Readonly<Record<NodeCategory, string>> = {
    trigger: 'text-trigger',
    logic: 'text-logic',
    system: 'text-system',
    state: 'text-state',
    utility: 'text-utility',
};

export function pipelineNodeToSpec(pipelineNode: PipelineNode): NodeSpec {
    if (isPluginNode(pipelineNode)) {
        return {
            type: pipelineNode.type,
            pluginId: pipelineNode.pluginId,
            config: structuredClone(pipelineNode.config),
        };
    }

    return {
        type: pipelineNode.type,
        config: structuredClone(pipelineNode.config),
    } as NodeSpec;
}
