import { PipelineConditionSchema } from '@sigil/schema/conditions';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { SwitchConfigSchema } from '@sigil/schema/nodes/switch';
import {
    CollisionSuffixStyleSchema,
    ConflictPolicySchema,
    SerializedPropertyDescriptorSchema,
} from '@sigil/schema/properties-file';
import { WorkflowContextSchema } from '@sigil/schema/workflow-context';
import { z } from 'zod';
import { WorkflowStatePrimitiveSchema } from '../shared/ipc-channels.js';
import { SubscriberRegistrationSchema } from './file-watcher-manager.js';

export const NodePluginWorkerKind = {
    Loaded: 'npw:loaded',
    LoadError: 'npw:load_error',
    ExecuteRequest: 'npw:execute_req',
    ExecuteResult: 'npw:execute_result',
    ExecuteError: 'npw:execute_error',
    ActivateRequest: 'npw:activate_req',
    ActivateResult: 'npw:activate_result',
    ActivateError: 'npw:activate_error',
    ActivateEvent: 'npw:activate_event',
    DepsRpc: 'npw:deps_rpc',
    DepsRpcResult: 'npw:deps_rpc_result',
    DepsRpcError: 'npw:deps_rpc_error',
    CallbackInvoke: 'npw:callback_invoke',
    Teardown: 'npw:teardown',
    UpdatePermissions: 'npw:update_permissions',
} as const;

// ─── Worker → Main ────────────────────────────────────────────

export const NodePluginWorkerLoadedSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.Loaded),
    descriptorType: z.string(),
    isTrigger: z.boolean(),
    propertyDescriptors: z.array(SerializedPropertyDescriptorSchema).readonly().optional(),
});
export type NodePluginWorkerLoaded = z.infer<typeof NodePluginWorkerLoadedSchema>;

export const NodePluginPropertyErrorSchema = z
    .object({
        kind: z.enum(['invalid', 'duplicate']),
        index: z.number().int().nonnegative(),
        key: z.string().min(1).optional(),
        message: z.string(),
    })
    .strict();
export type NodePluginPropertyError = z.infer<typeof NodePluginPropertyErrorSchema>;

export const NodePluginWorkerLoadErrorSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.LoadError),
    error: z.string(),
    propertyError: NodePluginPropertyErrorSchema.optional(),
});
export type NodePluginWorkerLoadError = z.infer<typeof NodePluginWorkerLoadErrorSchema>;

export const NodePluginWorkerExecuteResultSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ExecuteResult),
    requestId: z.string(),
    outputCtx: z.unknown(),
    activePort: z.string(),
});
export type NodePluginWorkerExecuteResult = z.infer<typeof NodePluginWorkerExecuteResultSchema>;

export const NodePluginWorkerExecuteErrorSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ExecuteError),
    requestId: z.string(),
    error: z.string(),
});
export type NodePluginWorkerExecuteError = z.infer<typeof NodePluginWorkerExecuteErrorSchema>;

export const NodePluginWorkerActivateResultSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ActivateResult),
    requestId: z.string(),
});
export type NodePluginWorkerActivateResult = z.infer<typeof NodePluginWorkerActivateResultSchema>;

export const NodePluginWorkerActivateErrorSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ActivateError),
    requestId: z.string(),
    error: z.string(),
});
export type NodePluginWorkerActivateError = z.infer<typeof NodePluginWorkerActivateErrorSchema>;

export const NodePluginWorkerActivateEventSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ActivateEvent),
    requestId: z.string(),
    event: z.string(),
    payload: z.unknown(),
    vars: z.record(z.string(), z.unknown()).optional(),
});
export type NodePluginWorkerActivateEvent = z.infer<typeof NodePluginWorkerActivateEventSchema>;

const NodePluginDepsRpcEnvelopeSchema = z
    .object({
        kind: z.literal(NodePluginWorkerKind.DepsRpc),
        requestId: z.string().min(1),
        executeRequestId: z.string().min(1).optional(),
    })
    .strict();

export const NodePluginDepsRpcSchema = z.discriminatedUnion('operation', [
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('event.emit'),
        args: z.tuple([z.string().min(1), z.record(z.string(), z.unknown())]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('sleep'),
        args: z.tuple([z.number()]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('resolveTemplate'),
        args: z.tuple([z.string(), WorkflowContextSchema]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('evaluateCondition'),
        args: z.tuple([PipelineConditionSchema, WorkflowContextSchema]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('matchSwitchCase'),
        args: z.tuple([SwitchConfigSchema, WorkflowContextSchema]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('state.get'),
        args: z.tuple([z.string()]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('state.set'),
        args: z.tuple([z.string(), WorkflowStatePrimitiveSchema]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('state.flush'),
        args: z.tuple([]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('capabilityBroker.request'),
        args: z.tuple([CapabilitySchema]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('fileWatcherManager.registerSubscriber'),
        args: z.tuple([SubscriberRegistrationSchema, z.string().min(1)]),
    }),
    NodePluginDepsRpcEnvelopeSchema.extend({
        operation: z.literal('fileWatcherManager.unregisterSubscriber'),
        args: z.tuple([z.string().min(1)]),
    }),
]);
export type NodePluginDepsRpc = z.infer<typeof NodePluginDepsRpcSchema>;
export type NodePluginDepsRpcOperation = NodePluginDepsRpc['operation'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NodePluginDepsRpcRequest = DistributiveOmit<
    NodePluginDepsRpc,
    'kind' | 'requestId' | 'executeRequestId'
>;

export type NodePluginDepsRpcArgs<TOperation extends NodePluginDepsRpcOperation> = Extract<
    NodePluginDepsRpcRequest,
    { operation: TOperation }
>['args'];

export const NodePluginDepsRpcResultSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.DepsRpcResult),
    requestId: z.string(),
    value: z.unknown(),
});
export type NodePluginDepsRpcResult = z.infer<typeof NodePluginDepsRpcResultSchema>;

export const NodePluginDepsRpcErrorSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.DepsRpcError),
    requestId: z.string(),
    error: z.string(),
});
export type NodePluginDepsRpcError = z.infer<typeof NodePluginDepsRpcErrorSchema>;

export const NodePluginWorkerToMainSchema = z.discriminatedUnion('kind', [
    NodePluginWorkerLoadedSchema,
    NodePluginWorkerLoadErrorSchema,
    NodePluginWorkerExecuteResultSchema,
    NodePluginWorkerExecuteErrorSchema,
    NodePluginWorkerActivateResultSchema,
    NodePluginWorkerActivateErrorSchema,
    NodePluginWorkerActivateEventSchema,
    NodePluginDepsRpcSchema,
]);
export type NodePluginWorkerToMain = z.infer<typeof NodePluginWorkerToMainSchema>;

// ─── Main → Worker ────────────────────────────────────────────

export const NodePluginWorkerExecuteRequestSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ExecuteRequest),
    requestId: z.string(),
    nodeType: z.string(),
    nodeConfig: z.unknown(),
    ctx: z.unknown(),
    deps: z
        .object({
            collisionSuffixStyle: CollisionSuffixStyleSchema.optional(),
            fileManager: z
                .object({
                    defaultOnConflict: ConflictPolicySchema,
                    collisionSuffixStyle: CollisionSuffixStyleSchema,
                })
                .optional(),
            properties: z.record(z.string(), z.unknown()).readonly().optional(),
        })
        .passthrough()
        .optional(),
});
export type NodePluginWorkerExecuteRequest = z.infer<typeof NodePluginWorkerExecuteRequestSchema>;

export const NodePluginWorkerActivateRequestSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.ActivateRequest),
    requestId: z.string(),
    config: z.unknown(),
});
export type NodePluginWorkerActivateRequest = z.infer<typeof NodePluginWorkerActivateRequestSchema>;

export const NodePluginWorkerTeardownSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.Teardown),
    requestId: z.string().min(1),
});
export type NodePluginWorkerTeardown = z.infer<typeof NodePluginWorkerTeardownSchema>;

export const NodePluginWorkerCallbackInvokeSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.CallbackInvoke),
    callbackId: z.string(),
    args: z.array(z.unknown()),
});
export type NodePluginWorkerCallbackInvoke = z.infer<typeof NodePluginWorkerCallbackInvokeSchema>;

export const NodePluginWorkerUpdatePermissionsSchema = z.object({
    kind: z.literal(NodePluginWorkerKind.UpdatePermissions),
    permissions: z.array(CapabilitySchema),
});
export type NodePluginWorkerUpdatePermissions = z.infer<
    typeof NodePluginWorkerUpdatePermissionsSchema
>;

export const NodePluginMainToWorkerSchema = z.discriminatedUnion('kind', [
    NodePluginWorkerExecuteRequestSchema,
    NodePluginWorkerActivateRequestSchema,
    NodePluginDepsRpcResultSchema,
    NodePluginDepsRpcErrorSchema,
    NodePluginWorkerCallbackInvokeSchema,
    NodePluginWorkerTeardownSchema,
    NodePluginWorkerUpdatePermissionsSchema,
]);
export type NodePluginMainToWorker = z.infer<typeof NodePluginMainToWorkerSchema>;

export type NodePluginWorkerRuntimeToMain = Exclude<
    NodePluginWorkerToMain,
    NodePluginWorkerLoaded | NodePluginWorkerLoadError
>;
