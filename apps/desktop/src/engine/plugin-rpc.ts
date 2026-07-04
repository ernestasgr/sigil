import { z } from 'zod';

export const PluginRpcKind = {
    EventEmit: 'plugin:event.emit',
    StateGet: 'plugin:state.get',
    StateSet: 'plugin:state.set',
    Log: 'plugin:log',
} as const;

export const PluginLifecycleKind = {
    Ready: 'plugin:ready',
    Error: 'plugin:error',
    Result: 'plugin:result',
} as const;

const PluginEventEmitRequestSchema = z.object({
    kind: z.literal(PluginRpcKind.EventEmit),
    requestId: z.string(),
    pluginId: z.string(),
    eventName: z.string(),
    payload: z.unknown(),
});

const PluginStateGetRequestSchema = z.object({
    kind: z.literal(PluginRpcKind.StateGet),
    requestId: z.string(),
    pluginId: z.string(),
    key: z.string(),
});

const PluginStateSetRequestSchema = z.object({
    kind: z.literal(PluginRpcKind.StateSet),
    requestId: z.string(),
    pluginId: z.string(),
    key: z.string(),
    value: z.unknown(),
});

const PluginLogRequestSchema = z.object({
    kind: z.literal(PluginRpcKind.Log),
    requestId: z.string(),
    pluginId: z.string(),
    message: z.string(),
});

export const PluginRpcRequestSchema = z.discriminatedUnion('kind', [
    PluginEventEmitRequestSchema,
    PluginStateGetRequestSchema,
    PluginStateSetRequestSchema,
    PluginLogRequestSchema,
]);
export type PluginRpcRequest = z.infer<typeof PluginRpcRequestSchema>;

export const PluginRpcResponseOkSchema = z.object({
    kind: z.literal(PluginLifecycleKind.Result),
    requestId: z.string(),
    ok: z.literal(true),
    value: z.unknown(),
});

export const PluginRpcResponseErrorSchema = z.object({
    kind: z.literal(PluginLifecycleKind.Result),
    requestId: z.string(),
    ok: z.literal(false),
    error: z.string(),
});

export const PluginRpcResponseSchema = z.discriminatedUnion('ok', [
    PluginRpcResponseOkSchema,
    PluginRpcResponseErrorSchema,
]);
export type PluginRpcResponse = z.infer<typeof PluginRpcResponseSchema>;

export const PluginWorkerReadySchema = z.object({
    kind: z.literal(PluginLifecycleKind.Ready),
    pluginId: z.string(),
});
export type PluginWorkerReady = z.infer<typeof PluginWorkerReadySchema>;

export const PluginWorkerErrorSchema = z.object({
    kind: z.literal(PluginLifecycleKind.Error),
    pluginId: z.string(),
    message: z.string(),
});
export type PluginWorkerError = z.infer<typeof PluginWorkerErrorSchema>;

export const PluginToEngineMessageSchema = z.discriminatedUnion('kind', [
    PluginEventEmitRequestSchema,
    PluginStateGetRequestSchema,
    PluginStateSetRequestSchema,
    PluginLogRequestSchema,
    PluginWorkerReadySchema,
    PluginWorkerErrorSchema,
]);
export type PluginToEngineMessage = z.infer<typeof PluginToEngineMessageSchema>;

export const EngineToPluginMessageSchema = PluginRpcResponseSchema;
export type EngineToPluginMessage = z.infer<typeof EngineToPluginMessageSchema>;
