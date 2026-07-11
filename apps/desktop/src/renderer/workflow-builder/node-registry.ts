import type { ComponentType } from 'react';
import { getNodeDescriptor, type NodeType, type BuiltinPipelineNode } from '@sigil/schema/nodes';

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

export type NodeCategory = 'trigger' | 'logic' | 'system' | 'state' | 'utility';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NodeSpec = DistributiveOmit<BuiltinPipelineNode, 'id'>;

type NodeConfigOf<K extends NodeType> = Extract<BuiltinPipelineNode, { type: K }>['config'];

interface NodeRegistryEntry<K extends NodeType> {
    readonly type: K;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
    readonly defaultConfig: NodeConfigOf<K>;
    readonly Form: ComponentType<ConfigFormProps<NodeConfigOf<K>>>;
}

type NodeRegistry = { readonly [K in NodeType]: NodeRegistryEntry<K> };

const NODE_TYPE_REGISTRY = {
    'file-watcher': {
        type: 'file-watcher',
        label: 'File Watcher',
        category: 'trigger',
        description:
            'Emits an event when files are created, modified, or deleted in a watched path.',
        defaultConfig: getNodeDescriptor('file-watcher').defaultConfig,
        Form: FileWatcherConfigForm,
    },
    'manual-trigger': {
        type: 'manual-trigger',
        label: 'Manual Trigger',
        category: 'trigger',
        description:
            'Fires a single event with a hand-crafted payload, for testing and manual runs.',
        defaultConfig: getNodeDescriptor('manual-trigger').defaultConfig,
        Form: ManualTriggerConfigForm,
    },
    'if-else': {
        type: 'if-else',
        label: 'If / Else',
        category: 'logic',
        description: 'Branches the flow down a true or false path based on a condition.',
        defaultConfig: getNodeDescriptor('if-else').defaultConfig,
        Form: IfElseConfigForm,
    },
    switch: {
        type: 'switch',
        label: 'Switch',
        category: 'logic',
        description:
            'Routes the flow to one of several cases (plus default) by event name or field value.',
        defaultConfig: getNodeDescriptor('switch').defaultConfig,
        Form: SwitchConfigForm,
    },
    'file-manager': {
        type: 'file-manager',
        label: 'File Manager',
        category: 'system',
        description: 'Moves, renames, or copies the file carried by the incoming event.',
        defaultConfig: getNodeDescriptor('file-manager').defaultConfig,
        Form: FileManagerConfigForm,
    },
    notification: {
        type: 'notification',
        label: 'Notification',
        category: 'system',
        description: 'Shows an OS notification with a title and body.',
        defaultConfig: getNodeDescriptor('notification').defaultConfig,
        Form: NotificationConfigForm,
    },
    'state-get': {
        type: 'state-get',
        label: 'State Get',
        category: 'state',
        description: 'Loads a value from workflow state into the workflow variables.',
        defaultConfig: getNodeDescriptor('state-get').defaultConfig,
        Form: StateGetConfigForm,
    },
    'state-set': {
        type: 'state-set',
        label: 'State Set',
        category: 'state',
        description: 'Writes a templated value into workflow state under a key.',
        defaultConfig: getNodeDescriptor('state-set').defaultConfig,
        Form: StateSetConfigForm,
    },
    log: {
        type: 'log',
        label: 'Log',
        category: 'utility',
        description: 'Emits a log line with a templated message.',
        defaultConfig: getNodeDescriptor('log').defaultConfig,
        Form: LogConfigForm,
    },
    delay: {
        type: 'delay',
        label: 'Delay',
        category: 'utility',
        description: 'Pauses the flow for a number of milliseconds.',
        defaultConfig: getNodeDescriptor('delay').defaultConfig,
        Form: DelayConfigForm,
    },
} as const satisfies NodeRegistry;

type NodeSpecRegistry = {
    readonly [K in NodeType]: Extract<NodeSpec, { type: K }>;
};

const DEFAULT_NODE_SPECS = {
    'file-watcher': {
        type: 'file-watcher',
        config: NODE_TYPE_REGISTRY['file-watcher'].defaultConfig,
    },
    'manual-trigger': {
        type: 'manual-trigger',
        config: NODE_TYPE_REGISTRY['manual-trigger'].defaultConfig,
    },
    'if-else': {
        type: 'if-else',
        config: NODE_TYPE_REGISTRY['if-else'].defaultConfig,
    },
    switch: {
        type: 'switch',
        config: NODE_TYPE_REGISTRY.switch.defaultConfig,
    },
    'file-manager': {
        type: 'file-manager',
        config: NODE_TYPE_REGISTRY['file-manager'].defaultConfig,
    },
    notification: {
        type: 'notification',
        config: NODE_TYPE_REGISTRY.notification.defaultConfig,
    },
    log: {
        type: 'log',
        config: NODE_TYPE_REGISTRY.log.defaultConfig,
    },
    delay: {
        type: 'delay',
        config: NODE_TYPE_REGISTRY.delay.defaultConfig,
    },
    'state-get': {
        type: 'state-get',
        config: NODE_TYPE_REGISTRY['state-get'].defaultConfig,
    },
    'state-set': {
        type: 'state-set',
        config: NODE_TYPE_REGISTRY['state-set'].defaultConfig,
    },
} satisfies NodeSpecRegistry;

export function defaultNodeSpec(type: NodeType): NodeSpec {
    return structuredClone(DEFAULT_NODE_SPECS[type]);
}

export type NodeTypeDef = NodeRegistry[NodeType];

export const NODE_TYPES: readonly NodeTypeDef[] = Object.values(NODE_TYPE_REGISTRY);

export function nodeTypeDef<K extends NodeType>(type: K): NodeRegistry[K] {
    return NODE_TYPE_REGISTRY[type];
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

const VALID_TYPES: ReadonlySet<string> = new Set(Object.keys(NODE_TYPE_REGISTRY));

export function isNodeType(value: unknown): value is NodeType {
    return typeof value === 'string' && VALID_TYPES.has(value);
}

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
