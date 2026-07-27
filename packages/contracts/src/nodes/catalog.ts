import type { z } from 'zod';

import { DelayDescriptor } from './delay.js';
import { FileManagerDescriptor } from './file-manager.js';
import { FileWatcherDescriptor } from './file-watcher.js';
import { IfElseDescriptor } from './if-else.js';
import { LogDescriptor } from './log.js';
import { ManualTriggerDescriptor } from './manual-trigger.js';
import { NotificationDescriptor } from './notification.js';
import { StateGetDescriptor } from './state-get.js';
import { StateSetDescriptor } from './state-set.js';
import { SwitchDescriptor } from './switch.js';
import type { NodeDescriptor } from './types.js';

/** Persisted built-in Node descriptors; no runtime registration occurs here. */
export const BUILTIN_NODE_DESCRIPTORS = Object.freeze([
    FileWatcherDescriptor,
    ManualTriggerDescriptor,
    IfElseDescriptor,
    SwitchDescriptor,
    FileManagerDescriptor,
    NotificationDescriptor,
    LogDescriptor,
    DelayDescriptor,
    StateGetDescriptor,
    StateSetDescriptor,
] as const) satisfies readonly NodeDescriptor<string, z.ZodType>[];

type BuiltinDescriptorUnion = (typeof BUILTIN_NODE_DESCRIPTORS)[number];

export type NodeType = BuiltinDescriptorUnion['type'];

export type BuiltinNodeConfig<K extends NodeType> = z.output<
    Extract<BuiltinDescriptorUnion, { readonly type: K }>['configSchema']
>;

export const BUILTIN_NODE_TYPE_VALUES = Object.freeze(
    BUILTIN_NODE_DESCRIPTORS.map(({ type }) => type),
) as unknown as readonly [NodeType, ...NodeType[]];

export const BUILTIN_NODE_DESCRIPTOR_BY_TYPE = Object.freeze(
    Object.fromEntries(BUILTIN_NODE_DESCRIPTORS.map((descriptor) => [descriptor.type, descriptor])),
) as {
    readonly [K in NodeType]: Extract<BuiltinDescriptorUnion, { readonly type: K }>;
};

export function getNodeDescriptor<K extends NodeType>(
    type: K,
): (typeof BUILTIN_NODE_DESCRIPTOR_BY_TYPE)[K] {
    return BUILTIN_NODE_DESCRIPTOR_BY_TYPE[type];
}
