import type { z } from 'zod';

import type {
    NodeContract,
    NodeContractIssue,
    NodeContractRegistration,
} from '../node-contract.js';

export type BuiltinNodeContractDefinition<TType extends string> = Omit<
    NodeContract,
    'defaultConfig' | 'identity'
> & {
    readonly identity: {
        readonly namespace: 'builtin';
        readonly type: TType;
    };
};

export interface NodeDescriptor<TType extends string, TSchema extends z.ZodType> {
    readonly type: TType;
    readonly configSchema: TSchema;
    readonly defaultConfig: z.output<TSchema>;
}

export function defineNode<TType extends string, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
): NodeDescriptor<TType, TSchema> {
    return descriptor;
}

export function defineNodeRegistration<TType extends string, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
    contract: BuiltinNodeContractDefinition<NoInfer<TType>>,
    options: {
        readonly validateConfig?: (config: z.output<TSchema>) => readonly NodeContractIssue[];
    } = {},
): NodeContractRegistration<TSchema> {
    return {
        contract: {
            ...contract,
            defaultConfig: descriptor.defaultConfig,
        },
        configSchema: descriptor.configSchema,
        ...(options.validateConfig ? { validateConfig: options.validateConfig } : {}),
    };
}

export type UnknownNodeDescriptor = NodeDescriptor<string, z.ZodType>;
