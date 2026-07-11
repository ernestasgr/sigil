import type { z } from 'zod';

export interface NodeDescriptor<TType extends string, TSchema extends z.ZodType> {
    readonly type: TType;
    readonly configSchema: TSchema;
    readonly defaultConfig: z.output<TSchema>;
    readonly getOutputPorts: (config: z.output<TSchema>) => readonly string[];
}

export function defineNode<TType extends string, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
): NodeDescriptor<TType, TSchema> {
    return descriptor;
}

export type UnknownNodeDescriptor = NodeDescriptor<string, z.ZodType>;
