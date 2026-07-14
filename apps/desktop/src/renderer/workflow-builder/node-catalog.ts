import type { Manifest } from '@sigil/schema/manifest';
import {
    type BuiltinPipelineNode,
    getNodeDescriptor,
    isPluginNode,
    type NodeDescriptor,
    type NodeType,
    type PipelineNode,
} from '@sigil/schema/nodes';
import { switchPortLabel } from '@sigil/schema/nodes/switch';
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

export interface PluginNodeCatalogAdapter<TConfig> {
    readonly pluginId: string;
    readonly type: string;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly defaultConfig: TConfig;
    readonly configSchema: z.ZodType<TConfig>;
    readonly isTrigger: boolean;
    readonly outputPorts: (config: TConfig) => readonly string[] | 'dynamic';
    readonly outputPortLabel?: (config: TConfig, port: string) => string;
    readonly showInPalette?: boolean;
    readonly Form?: ComponentType<ConfigFormProps<TConfig>>;
}

export type NodeCatalogManifest = Pick<Manifest, 'id' | 'nodeType'>;

interface BuiltinNodeCatalogAdapter<K extends NodeType, TSchema extends z.ZodType> {
    readonly descriptor: NodeDescriptor<K, TSchema>;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly isTrigger: boolean;
    readonly outputPortLabel?: (config: z.output<TSchema>, port: string) => string;
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

function outputPortLabelForConfig<TSchema extends z.ZodType>(
    configSchema: TSchema,
    outputPortLabel: ((config: z.output<TSchema>, port: string) => string) | undefined,
    config: unknown,
    port: string,
): string {
    const validation = validateConfig(configSchema, config);
    return validation.ok ? (outputPortLabel?.(validation.value, port) ?? port) : port;
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
    return {
        source: 'builtin',
        type: descriptor.type,
        label: adapter.label,
        category: adapter.category,
        description: adapter.description,
        defaultConfig: descriptor.defaultConfig,
        isTrigger: adapter.isTrigger,
        validateConfig: (config) => validateConfig(descriptor.configSchema, config),
        outputPorts: (config) =>
            outputPortsForConfig(descriptor.configSchema, descriptor.getOutputPorts, config),
        outputPortLabel: (config, port) =>
            outputPortLabelForConfig(
                descriptor.configSchema,
                adapter.outputPortLabel,
                config,
                port,
            ),
        showInPalette: true,
        authoring: 'editable',
        Form: createNodeConfigForm(descriptor.type, adapter.Form, descriptor.configSchema),
    };
}

export function createPluginNodeCatalogEntry<TConfig>(
    adapter: PluginNodeCatalogAdapter<TConfig>,
): PluginNodeCatalogEntry {
    const Form = adapter.Form
        ? createNodeConfigForm(adapter.type, adapter.Form, adapter.configSchema)
        : undefined;
    return {
        source: 'plugin',
        pluginId: adapter.pluginId,
        type: adapter.type,
        label: adapter.label,
        category: adapter.category,
        description: adapter.description,
        defaultConfig: adapter.defaultConfig,
        isTrigger: adapter.isTrigger,
        validateConfig: (config) => validateConfig(adapter.configSchema, config),
        outputPorts: (config) =>
            outputPortsForConfig(adapter.configSchema, adapter.outputPorts, config),
        outputPortLabel: (config, port) =>
            outputPortLabelForConfig(adapter.configSchema, adapter.outputPortLabel, config, port),
        showInPalette: adapter.showInPalette ?? true,
        authoring: Form ? 'editable' : 'read-only',
        ...(Form ? { Form } : {}),
    };
}

const BUILTIN_NODE_CATALOG_ENTRIES: readonly BuiltinNodeCatalogEntry[] = [
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('file-watcher'),
        label: 'File Watcher',
        category: 'trigger',
        description:
            'Emits an event when files are created, modified, or deleted in a watched path.',
        isTrigger: true,
        Form: FileWatcherConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('manual-trigger'),
        label: 'Manual Trigger',
        category: 'trigger',
        description:
            'Fires a single event with a hand-crafted payload, for testing and manual runs.',
        isTrigger: true,
        Form: ManualTriggerConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('if-else'),
        label: 'If / Else',
        category: 'logic',
        description: 'Branches the flow down a true or false path based on a condition.',
        isTrigger: false,
        Form: IfElseConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('switch'),
        label: 'Switch',
        category: 'logic',
        description:
            'Routes the flow to one of several cases (plus default) by event name or field value.',
        isTrigger: false,
        outputPortLabel: switchPortLabel,
        Form: SwitchConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('file-manager'),
        label: 'File Manager',
        category: 'system',
        description: 'Moves, renames, or copies the file carried by the incoming event.',
        isTrigger: false,
        Form: FileManagerConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('notification'),
        label: 'Notification',
        category: 'system',
        description: 'Shows an OS notification with a title and body.',
        isTrigger: false,
        Form: NotificationConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('state-get'),
        label: 'State Get',
        category: 'state',
        description: 'Loads a value from workflow state into the workflow variables.',
        isTrigger: false,
        Form: StateGetConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('state-set'),
        label: 'State Set',
        category: 'state',
        description: 'Writes a templated value into workflow state under a key.',
        isTrigger: false,
        Form: StateSetConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('log'),
        label: 'Log',
        category: 'utility',
        description: 'Emits a log line with a templated message.',
        isTrigger: false,
        Form: LogConfigForm,
    }),
    createBuiltinNodeCatalogEntry({
        descriptor: getNodeDescriptor('delay'),
        label: 'Delay',
        category: 'utility',
        description: 'Pauses the flow for a number of milliseconds.',
        isTrigger: false,
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
    readonly findBuiltin: (type: NodeType) => BuiltinNodeCatalogEntry | undefined;
    readonly findPlugin: (pluginId: string, type: string) => PluginNodeCatalogEntry | undefined;
    readonly findForSpec: (spec: NodeSpec) => NodeCatalogEntry | undefined;
    /** Compatibility lookup for callers that already know a Plugin identity. */
    readonly find: (pluginId: string, type: string) => PluginNodeCatalogEntry | undefined;
}

export interface NodeCatalogOptions {
    readonly includeBundledPluginEntries?: boolean;
}

export function createNodeCatalog(
    additionalEntries: readonly PluginNodeCatalogEntry[] = [],
    options: NodeCatalogOptions = {},
): NodeCatalog {
    const builtinEntries = new Map<NodeType, BuiltinNodeCatalogEntry>();
    for (const entry of BUILTIN_NODE_CATALOG) builtinEntries.set(entry.type, entry);

    const pluginEntries = new Map<string, PluginNodeCatalogEntry>();
    const bundledPluginEntries =
        options.includeBundledPluginEntries === false ? [] : BUILTIN_PLUGIN_NODE_CATALOG;
    for (const entry of [...bundledPluginEntries, ...additionalEntries]) {
        const key = pluginKey(entry.pluginId, entry.type);
        if (!pluginEntries.has(key)) pluginEntries.set(key, normalizePluginEntry(entry));
    }

    const entries = Object.freeze([
        ...builtinEntries.values(),
        ...pluginEntries.values(),
    ] as NodeCatalogEntry[]);
    const findPlugin = (pluginId: string, type: string): PluginNodeCatalogEntry | undefined =>
        pluginEntries.get(pluginKey(pluginId, type));

    return {
        entries,
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
    const entries = adapters.filter((entry) =>
        manifests.some(
            (manifest) => manifest.id === entry.pluginId && manifest.nodeType === entry.type,
        ),
    );
    return createNodeCatalog(entries, { includeBundledPluginEntries: false });
}

function normalizePluginEntry(entry: PluginNodeCatalogEntry): PluginNodeCatalogEntry {
    return {
        ...entry,
        outputPortLabel: entry.outputPortLabel ?? ((_config, port) => port),
        showInPalette: entry.showInPalette ?? true,
        authoring: entry.authoring ?? (entry.Form ? 'editable' : 'read-only'),
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
        outputPortLabel: (_config, port) => port,
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

    const validation = entry.validateConfig(spec.config);
    const authoring = entry.authoring ?? (entry.Form ? 'editable' : 'read-only');
    const readOnlyReason =
        entry.source === 'plugin' && !entry.Form
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
        isTrigger: entry.isTrigger,
        outputPorts: validation.ok ? entry.outputPorts(validation.value) : 'dynamic',
        outputPortLabel: (config, port) => {
            const parsed = entry.validateConfig(config);
            return parsed.ok ? (entry.outputPortLabel?.(parsed.value, port) ?? port) : port;
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
