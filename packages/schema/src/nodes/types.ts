import { z } from 'zod';

export interface NodeDescriptor<TType extends string, TConfig> {
    readonly type: TType;
    readonly configSchema: z.ZodType<TConfig>;
    readonly defaultConfig: TConfig;
    readonly getOutputPorts: (config: unknown) => readonly string[];
}

export function defineNode<TType extends string, TConfig>(
    descriptor: NodeDescriptor<TType, TConfig>,
): NodeDescriptor<TType, TConfig> {
    return descriptor;
}
