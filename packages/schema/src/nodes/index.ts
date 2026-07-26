import { z } from 'zod';
import {
    type PipelineNodeId,
    PipelineNodeIdSchema,
    type PluginId,
    PluginIdSchema,
} from '../ids.js';
import { BUILTIN_NODE_DESCRIPTORS, BUILTIN_NODE_TYPE_VALUES } from '../node-contract.js';
import type { NodeDescriptor } from './types.js';

export type { NodeOutputPortId, PipelineEdgeId, PipelineNodeId, PluginId } from '../ids.js';
export { NodeOutputPortIdSchema, PipelineNodeIdSchema, PluginIdSchema } from '../ids.js';
export type {
    DeclarativeOutputPortResolution,
    NodeCategory,
    NodeContract,
    NodeContractDisplay,
    NodeContractInput,
    NodeContractIssue,
    NodeContractIssueCode,
    NodeContractRegistration,
    NodeContractRegistry,
    NodeContractResolution,
    NodeContractSnapshot,
    NodeIdentity,
    NodeNamespace,
    NodeOutputPort,
    NodeOutputPortInput,
    NodeOutputPortSpec,
    NodeOutputPortSpecInput,
    NodeRole,
    NodeType,
    ParsedNodeContract,
    SerializableJsonValue,
    SerializableNodeContract,
    SerializableNodeContractInput,
} from '../node-contract.js';
export {
    BUILTIN_NODE_CONTRACT_REGISTRATIONS,
    BUILTIN_NODE_CONTRACT_REGISTRY,
    BUILTIN_NODE_DESCRIPTORS,
    BUILTIN_NODE_TYPE_VALUES,
    builtinNodeIdentity,
    CURRENT_NODE_CONTRACT_VERSION,
    createBuiltinNodeContractRegistry,
    createNodeContractRegistry,
    fixedOutputPort,
    fixedOutputPortSpec,
    formatNodeIdentity,
    getBuiltinNodeContract,
    NodeCategorySchema,
    NodeContractDisplaySchema,
    NodeContractIssueCodeSchema,
    NodeContractIssueSchema,
    NodeContractSchema,
    NodeContractSnapshotListSchema,
    NodeContractSnapshotSchema,
    NodeIdentitySchema,
    NodeNamespaceSchema,
    NodeOutputPortSchema,
    NodeOutputPortSpecSchema,
    NodeRoleSchema,
    nodeIdentityForNode,
    nodeIdentityKey,
    outputPortDescriptorsForNode,
    outputPortIdsForNode,
    pluginNodeIdentity,
    registerSerializableNodeContract,
    resolveDeclarativeOutputPorts,
    resolveNodeContract,
    SerializableJsonValueSchema,
    SerializableNodeContractSchema,
    switchOutputPortSpec,
    validatePluginNodeContract,
} from '../node-contract.js';
export type { DelayConfig } from './delay.js';
export type { FileManagerConfig } from './file-manager.js';
export type { FileWatcherConfig } from './file-watcher.js';
export type { IfElseConfig } from './if-else.js';
export type { LogConfig } from './log.js';
export type { ManualTriggerConfig } from './manual-trigger.js';
export type { NotificationConfig } from './notification.js';
export type { StateGetConfig } from './state-get.js';
export type { StateSetConfig, StateSetValueType } from './state-set.js';
export {
    STATE_SET_VALUE_TYPES,
    StateSetValueTypeSchema,
} from './state-set.js';
export type {
    SwitchCase,
    SwitchCaseId,
    SwitchConfig,
    SwitchDiagnostic,
    SwitchDiagnosticCode,
} from './switch.js';
export {
    SWITCH_DEFAULT_PORT,
    SWITCH_DIAGNOSTIC_CODES,
    SwitchCaseIdSchema,
    SwitchCaseSchema,
    validateSwitchConfig,
} from './switch.js';
export type { NodeDescriptor, UnknownNodeDescriptor } from './types.js';

// ─── Registry ───────────────────────────────────────────────────

const NODE_TYPE_VALUES = BUILTIN_NODE_TYPE_VALUES;
type NodeType = (typeof NODE_TYPE_VALUES)[number];

const NODE_DESCRIPTORS = BUILTIN_NODE_DESCRIPTORS;

type NodeConfigMap = {
    [K in NodeType]: z.infer<(typeof NODE_DESCRIPTORS)[K]['configSchema']>;
};

// ─── NodeTypeSchema ─────────────────────────────────────────────

export const NodeTypeSchema = z.enum(NODE_TYPE_VALUES);

// ─── BuiltinPipelineNode (derived from NODE_DESCRIPTORS) ────────

export type BuiltinPipelineNode = {
    [K in NodeType]: {
        readonly id: PipelineNodeId;
        readonly type: K;
        readonly config: NodeConfigMap[K];
    };
}[NodeType];

// ─── PluginPipelineNode ─────────────────────────────────────────

export interface PluginPipelineNode {
    readonly id: PipelineNodeId;
    readonly type: string;
    readonly pluginId: PluginId;
    readonly config: unknown;
}

// ─── PipelineNode (builtin | plugin) ────────────────────────────

export type PipelineNode = BuiltinPipelineNode | PluginPipelineNode;

export function isPluginNode(node: PipelineNode): node is PluginPipelineNode {
    return 'pluginId' in node;
}

export function isBuiltinNode(node: PipelineNode): node is BuiltinPipelineNode {
    return !('pluginId' in node);
}

// ─── PipelineNodeSchema (derived from NODE_DESCRIPTORS) ─────────

function createBuiltinNodeSchema<TType extends NodeType, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
) {
    return z.object({
        id: PipelineNodeIdSchema,
        type: z.literal(descriptor.type),
        config: descriptor.configSchema,
    });
}

const builtinNodeSchemas = [
    createBuiltinNodeSchema(NODE_DESCRIPTORS['file-watcher']),
    createBuiltinNodeSchema(NODE_DESCRIPTORS['manual-trigger']),
    createBuiltinNodeSchema(NODE_DESCRIPTORS['if-else']),
    createBuiltinNodeSchema(NODE_DESCRIPTORS.switch),
    createBuiltinNodeSchema(NODE_DESCRIPTORS['file-manager']),
    createBuiltinNodeSchema(NODE_DESCRIPTORS.notification),
    createBuiltinNodeSchema(NODE_DESCRIPTORS.log),
    createBuiltinNodeSchema(NODE_DESCRIPTORS.delay),
    createBuiltinNodeSchema(NODE_DESCRIPTORS['state-get']),
    createBuiltinNodeSchema(NODE_DESCRIPTORS['state-set']),
] as const;

const BuiltinPipelineNodeSchema = z.discriminatedUnion('type', builtinNodeSchemas);

const PluginPipelineNodeSchema = z.object({
    id: PipelineNodeIdSchema,
    type: z.string().min(1),
    pluginId: PluginIdSchema,
    config: z.unknown(),
});

// Try plugin nodes first so an object carrying a pluginId remains a plugin
// node even when its type happens to match a builtin node name.
export const PipelineNodeSchema = z.union([PluginPipelineNodeSchema, BuiltinPipelineNodeSchema]);
