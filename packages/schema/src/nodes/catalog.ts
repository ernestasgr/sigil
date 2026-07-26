import type { z } from 'zod';

import {
    createNodeContractRegistry,
    type NodeContract,
    type NodeContractRegistration,
    type NodeContractRegistry,
} from '../node-contract.js';
import { DelayNode } from './delay.js';
import { FileManagerNode } from './file-manager.js';
import { FileWatcherNode } from './file-watcher.js';
import { IfElseNode } from './if-else.js';
import { LogNode } from './log.js';
import { ManualTriggerNode } from './manual-trigger.js';
import { NotificationNode } from './notification.js';
import { StateGetNode } from './state-get.js';
import { StateSetNode } from './state-set.js';
import { SwitchNode, switchOutputPortStrategy } from './switch.js';
import type { BuiltinNodeDefinition } from './types.js';

/** The complete built-in catalog. Order is the stable registration order. */
export const BUILTIN_NODE_DEFINITIONS = Object.freeze([
    FileWatcherNode,
    ManualTriggerNode,
    IfElseNode,
    SwitchNode,
    FileManagerNode,
    NotificationNode,
    LogNode,
    DelayNode,
    StateGetNode,
    StateSetNode,
] as const) satisfies readonly BuiltinNodeDefinition<string, z.ZodType>[];

type BuiltinNodeDefinitionUnion = (typeof BUILTIN_NODE_DEFINITIONS)[number];

export type NodeType = BuiltinNodeDefinitionUnion['descriptor']['type'];

export type BuiltinNodeConfig<K extends NodeType> = z.output<
    Extract<
        BuiltinNodeDefinitionUnion,
        { readonly descriptor: { readonly type: K } }
    >['descriptor']['configSchema']
>;

export const BUILTIN_NODE_TYPE_VALUES = Object.freeze(
    BUILTIN_NODE_DEFINITIONS.map(({ descriptor }) => descriptor.type),
) as unknown as readonly [NodeType, ...NodeType[]];

/** Compatibility lookup derived from BUILTIN_NODE_DEFINITIONS. */
export const BUILTIN_NODE_DESCRIPTORS = Object.freeze(
    Object.fromEntries(
        BUILTIN_NODE_DEFINITIONS.map(({ descriptor }) => [descriptor.type, descriptor]),
    ),
) as {
    readonly [K in NodeType]: Extract<
        BuiltinNodeDefinitionUnion,
        { readonly descriptor: { readonly type: K } }
    >['descriptor'];
};

/** Runtime registrations derived from the same definitions as the descriptor lookup. */
export const BUILTIN_NODE_CONTRACT_REGISTRATIONS: readonly NodeContractRegistration[] =
    Object.freeze(BUILTIN_NODE_DEFINITIONS.map(({ registration }) => registration));

export function createBuiltinNodeContractRegistry(): NodeContractRegistry {
    return createNodeContractRegistry(BUILTIN_NODE_CONTRACT_REGISTRATIONS, {
        outputPortStrategies: {
            'switch-cases': switchOutputPortStrategy,
        },
    });
}

const builtinContractLookup = createBuiltinNodeContractRegistry();

export function getNodeDescriptor<K extends NodeType>(
    type: K,
): (typeof BUILTIN_NODE_DESCRIPTORS)[K] {
    return BUILTIN_NODE_DESCRIPTORS[type];
}

export function getBuiltinNodeContract(type: NodeType): NodeContract {
    const contract = builtinContractLookup.get({
        namespace: 'builtin',
        type,
    });
    if (!contract) throw new Error(`Missing built-in Node Contract for "${type}".`);
    return contract;
}
