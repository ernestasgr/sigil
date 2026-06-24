import type { NodeType } from '@sigil/schema/nodes';

export type NodeCategory = 'trigger' | 'logic' | 'system' | 'state' | 'utility';

export interface NodeTypeDef {
    readonly type: NodeType;
    readonly label: string;
    readonly category: NodeCategory;
    readonly description: string;
}

const NODE_TYPE_REGISTRY: Readonly<Record<NodeType, NodeTypeDef>> = {
    'file-watcher': {
        type: 'file-watcher',
        label: 'File Watcher',
        category: 'trigger',
        description:
            'Emits an event when files are created, modified, or deleted in a watched path.',
    },
    'manual-trigger': {
        type: 'manual-trigger',
        label: 'Manual Trigger',
        category: 'trigger',
        description:
            'Fires a single event with a hand-crafted payload, for testing and manual runs.',
    },
    'if-else': {
        type: 'if-else',
        label: 'If / Else',
        category: 'logic',
        description: 'Branches the flow down a true or false path based on a condition.',
    },
    switch: {
        type: 'switch',
        label: 'Switch',
        category: 'logic',
        description:
            'Routes the flow to one of several cases (plus default) by event name or field value.',
    },
    'file-manager': {
        type: 'file-manager',
        label: 'File Manager',
        category: 'system',
        description: 'Moves, renames, or copies the file carried by the incoming event.',
    },
    notification: {
        type: 'notification',
        label: 'Notification',
        category: 'system',
        description: 'Shows an OS notification with a title and body.',
    },
    'state-get': {
        type: 'state-get',
        label: 'State Get',
        category: 'state',
        description: 'Loads a value from workflow state into the workflow variables.',
    },
    'state-set': {
        type: 'state-set',
        label: 'State Set',
        category: 'state',
        description: 'Writes a templated value into workflow state under a key.',
    },
    log: {
        type: 'log',
        label: 'Log',
        category: 'utility',
        description: 'Emits a log line with a templated message.',
    },
    delay: {
        type: 'delay',
        label: 'Delay',
        category: 'utility',
        description: 'Pauses the flow for a number of milliseconds.',
    },
};

export const NODE_TYPES: readonly NodeTypeDef[] = Object.values(NODE_TYPE_REGISTRY);

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

export function nodeTypeDef(type: NodeType): NodeTypeDef {
    return NODE_TYPE_REGISTRY[type];
}

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
