import { z } from 'zod';
import { DelayDescriptor } from './delay.js';
import { FileManagerDescriptor } from './file-manager.js';
import { FileWatcherDescriptor } from './file-watcher.js';
import { IfElseDescriptor } from './if-else.js';
import { LogDescriptor } from './log.js';
import { ManualTriggerDescriptor } from './manual-trigger.js';
import { NotificationDescriptor } from './notification.js';
import { StateGetDescriptor } from './state-get.js';
import { StateSetDescriptor } from './state-set.js';
import { SwitchDescriptor, switchPortLabel } from './switch.js';
import type { NodeDescriptor } from './types.js';

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
export type { SwitchCase, SwitchConfig, SwitchDiagnostic, SwitchDiagnosticCode } from './switch.js';
export {
    SWITCH_DEFAULT_PORT,
    SWITCH_DIAGNOSTIC_CODES,
    SwitchCaseSchema,
    switchPortLabel,
    validateSwitchConfig,
} from './switch.js';
export type { NodeDescriptor, UnknownNodeDescriptor } from './types.js';

// ─── Registry ───────────────────────────────────────────────────

const NODE_TYPE_VALUES = [
    'file-watcher',
    'manual-trigger',
    'if-else',
    'switch',
    'file-manager',
    'notification',
    'log',
    'delay',
    'state-get',
    'state-set',
] as const;

export type NodeType = (typeof NODE_TYPE_VALUES)[number];

const NODE_DESCRIPTORS = {
    'file-watcher': FileWatcherDescriptor,
    'manual-trigger': ManualTriggerDescriptor,
    'if-else': IfElseDescriptor,
    switch: SwitchDescriptor,
    'file-manager': FileManagerDescriptor,
    notification: NotificationDescriptor,
    log: LogDescriptor,
    delay: DelayDescriptor,
    'state-get': StateGetDescriptor,
    'state-set': StateSetDescriptor,
} as const satisfies { readonly [K in NodeType]: { readonly type: K } };

type NodeConfigMap = {
    [K in NodeType]: z.infer<(typeof NODE_DESCRIPTORS)[K]['configSchema']>;
};

type DescriptorRegistry = {
    readonly [K in NodeType]: NodeDescriptor<K, (typeof NODE_DESCRIPTORS)[K]['configSchema']>;
};

const nodeDescriptors: DescriptorRegistry = NODE_DESCRIPTORS;

export function getNodeDescriptor<K extends NodeType>(type: K): DescriptorRegistry[K] {
    return nodeDescriptors[type];
}

// ─── NodeTypeSchema ─────────────────────────────────────────────

export const NodeTypeSchema = z.enum(NODE_TYPE_VALUES);

// ─── BuiltinPipelineNode (derived from NODE_DESCRIPTORS) ────────

export type BuiltinPipelineNode = {
    [K in NodeType]: {
        readonly id: string;
        readonly type: K;
        readonly config: NodeConfigMap[K];
    };
}[NodeType];

// ─── PluginPipelineNode ─────────────────────────────────────────

export interface PluginPipelineNode {
    readonly id: string;
    readonly type: string;
    readonly pluginId: string;
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
        id: z.string().min(1),
        type: z.literal(descriptor.type),
        config: descriptor.configSchema,
    });
}

const builtinNodeSchemas = [
    createBuiltinNodeSchema(FileWatcherDescriptor),
    createBuiltinNodeSchema(ManualTriggerDescriptor),
    createBuiltinNodeSchema(IfElseDescriptor),
    createBuiltinNodeSchema(SwitchDescriptor),
    createBuiltinNodeSchema(FileManagerDescriptor),
    createBuiltinNodeSchema(NotificationDescriptor),
    createBuiltinNodeSchema(LogDescriptor),
    createBuiltinNodeSchema(DelayDescriptor),
    createBuiltinNodeSchema(StateGetDescriptor),
    createBuiltinNodeSchema(StateSetDescriptor),
] as const;

const BuiltinPipelineNodeSchema = z.discriminatedUnion('type', builtinNodeSchemas);

const PluginPipelineNodeSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    pluginId: z.string().min(1),
    config: z.unknown(),
});

// Try plugin nodes first so an object carrying a pluginId remains a plugin
// node even when its type happens to match a builtin node name.
export const PipelineNodeSchema = z.union([PluginPipelineNodeSchema, BuiltinPipelineNodeSchema]);

// ─── Output ports ───────────────────────────────────────────────

export function outputPortsForNode(node: PipelineNode): readonly string[] {
    if (isPluginNode(node)) {
        return [];
    }

    switch (node.type) {
        case 'file-watcher':
            return nodeDescriptors['file-watcher'].getOutputPorts(node.config);
        case 'manual-trigger':
            return nodeDescriptors['manual-trigger'].getOutputPorts(node.config);
        case 'if-else':
            return nodeDescriptors['if-else'].getOutputPorts(node.config);
        case 'switch':
            return nodeDescriptors.switch.getOutputPorts(node.config);
        case 'file-manager':
            return nodeDescriptors['file-manager'].getOutputPorts(node.config);
        case 'notification':
            return nodeDescriptors.notification.getOutputPorts(node.config);
        case 'log':
            return nodeDescriptors.log.getOutputPorts(node.config);
        case 'delay':
            return nodeDescriptors.delay.getOutputPorts(node.config);
        case 'state-get':
            return nodeDescriptors['state-get'].getOutputPorts(node.config);
        case 'state-set':
            return nodeDescriptors['state-set'].getOutputPorts(node.config);
        default:
            return assertNever(node);
    }
}

export function outputPortLabelForNode(node: PipelineNode, port: string): string {
    if (isPluginNode(node)) return port;

    switch (node.type) {
        case 'file-watcher':
        case 'manual-trigger':
        case 'if-else':
        case 'file-manager':
        case 'notification':
        case 'log':
        case 'delay':
        case 'state-get':
        case 'state-set':
            return port;
        case 'switch':
            return switchPortLabel(node.config, port);
        default:
            return assertNever(node);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled node type: ${JSON.stringify(value)}`);
}
