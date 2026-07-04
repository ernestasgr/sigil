import { z } from 'zod';

export interface NodeDescriptor<
    TType extends string,
    TConfig,
    TSchema extends z.ZodType<TConfig> = z.ZodType<TConfig>,
> {
    readonly type: TType;
    readonly configSchema: TSchema;
    readonly defaultConfig: TConfig;
    readonly getOutputPorts: (config: unknown) => readonly string[];
}

export function defineNode<TType extends string, TConfig, TSchema extends z.ZodType<TConfig>>(
    descriptor: NodeDescriptor<TType, NoInfer<TConfig>, TSchema>,
): NodeDescriptor<TType, TConfig, TSchema> {
    return descriptor as unknown as NodeDescriptor<TType, TConfig, TSchema>;
}
