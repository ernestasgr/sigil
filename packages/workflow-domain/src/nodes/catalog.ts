import type { NodeType } from '@sigil/contracts/workflow';
import type { z } from 'zod';
import {
    builtinNodeIdentity,
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
import type { BuiltinNodeDefinition, NodeDescriptor } from './types.js';

export type { NodeType } from '@sigil/contracts/workflow';

/** The authoring descriptor exposed by the Workflow domain catalog. */
export type BuiltinNodeDescriptor<
    TType extends NodeType = NodeType,
    TSchema extends z.ZodType = z.ZodType,
> = NodeDescriptor<TType, TSchema>;

type BuiltinNodeDefinitionUnion =
    | typeof FileWatcherNode
    | typeof ManualTriggerNode
    | typeof IfElseNode
    | typeof SwitchNode
    | typeof FileManagerNode
    | typeof NotificationNode
    | typeof LogNode
    | typeof DelayNode
    | typeof StateGetNode
    | typeof StateSetNode;

const builtinNodeDefinitions = Object.freeze([
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
] as const satisfies readonly BuiltinNodeDefinition<string, z.ZodType>[]);

type BuiltinDescriptorByType = {
    readonly [K in NodeType]: Extract<
        BuiltinNodeDefinitionUnion,
        { readonly descriptor: { readonly type: K } }
    >['descriptor'];
};

const builtinDescriptors = Object.freeze(
    Object.fromEntries(
        builtinNodeDefinitions.map(({ descriptor }) => [descriptor.type, descriptor]),
    ),
) as BuiltinDescriptorByType;

const builtinContractRegistrations: readonly NodeContractRegistration[] = Object.freeze(
    builtinNodeDefinitions.map(({ registration }) => registration),
);

export function getBuiltinNodeDescriptor<K extends NodeType>(type: K): BuiltinDescriptorByType[K] {
    return builtinDescriptors[type];
}

export function createBuiltinNodeContractRegistry(): NodeContractRegistry {
    return createNodeContractRegistry(builtinContractRegistrations, {
        outputPortStrategies: {
            'switch-cases': switchOutputPortStrategy,
        },
    });
}

export function getBuiltinNodeContract(type: NodeType): NodeContract {
    const contract = createBuiltinNodeContractRegistry().get(builtinNodeIdentity(type));
    if (!contract) throw new Error(`Missing built-in Node Contract for "${type}".`);
    return contract;
}
