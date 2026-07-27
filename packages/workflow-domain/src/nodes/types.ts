import type { NodeContractDefinition, NodeContractIssue } from '@sigil/contracts/node-contract';
import type { z } from 'zod';
import type {
    DeclarativeOutputPortResolution,
    NodeContractRegistration,
} from '../node-contract.js';

export type BuiltinNodeContractDefinition<TType extends string> = Omit<
    NodeContractDefinition,
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

export interface BuiltinNodeDefinition<TType extends string, TSchema extends z.ZodType> {
    readonly descriptor: NodeDescriptor<TType, TSchema>;
    readonly registration: NodeContractRegistration<TSchema>;
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
        readonly resolveOutputPorts?: (
            config: z.output<TSchema>,
        ) => DeclarativeOutputPortResolution;
    } = {},
): NodeContractRegistration<TSchema> {
    return {
        contract: {
            ...contract,
            defaultConfig: descriptor.defaultConfig,
        },
        configSchema: descriptor.configSchema,
        ...(options.validateConfig ? { validateConfig: options.validateConfig } : {}),
        ...(options.resolveOutputPorts ? { resolveOutputPorts: options.resolveOutputPorts } : {}),
    };
}

export interface BuiltinNodeDefinitionInput<TType extends string, TSchema extends z.ZodType> {
    readonly type: TType;
    readonly configSchema: TSchema;
    readonly defaultConfig: z.output<TSchema>;
    readonly contract: BuiltinNodeContractDefinition<NoInfer<TType>>;
    readonly validateConfig?: (config: z.output<TSchema>) => readonly NodeContractIssue[];
    readonly resolveOutputPorts?: (config: z.output<TSchema>) => DeclarativeOutputPortResolution;
}

export function defineBuiltinNode<TType extends string, TSchema extends z.ZodType>(
    definition: BuiltinNodeDefinitionInput<TType, TSchema>,
): BuiltinNodeDefinition<TType, TSchema> {
    const descriptor = defineNode({
        type: definition.type,
        configSchema: definition.configSchema,
        defaultConfig: definition.defaultConfig,
    });
    const registration = defineNodeRegistration(descriptor, definition.contract, {
        ...(definition.validateConfig ? { validateConfig: definition.validateConfig } : {}),
        ...(definition.resolveOutputPorts
            ? { resolveOutputPorts: definition.resolveOutputPorts }
            : {}),
    });
    return { descriptor, registration };
}

export type UnknownNodeDescriptor = NodeDescriptor<string, z.ZodType>;
