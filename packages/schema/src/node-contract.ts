import { z } from 'zod';

import { DelayDescriptor } from './nodes/delay.js';
import { FileManagerDescriptor } from './nodes/file-manager.js';
import { FileWatcherDescriptor } from './nodes/file-watcher.js';
import { IfElseDescriptor } from './nodes/if-else.js';
import { LogDescriptor } from './nodes/log.js';
import { ManualTriggerDescriptor } from './nodes/manual-trigger.js';
import { NotificationDescriptor } from './nodes/notification.js';
import { StateGetDescriptor } from './nodes/state-get.js';
import { StateSetDescriptor } from './nodes/state-set.js';
import {
    SWITCH_DEFAULT_PORT,
    type SwitchConfig,
    SwitchConfigSchema,
    SwitchDescriptor,
    validateSwitchConfig,
} from './nodes/switch.js';
import type { NodeDescriptor } from './nodes/types.js';

export const NodeNamespaceSchema = z.enum(['builtin', 'plugin']);
export type NodeNamespace = z.infer<typeof NodeNamespaceSchema>;

export const CURRENT_NODE_CONTRACT_VERSION = 1 as const;

export const DEFAULT_NODE_CONTRACT_COMPATIBILITY = {
    minimumReaderVersion: CURRENT_NODE_CONTRACT_VERSION,
    maximumReaderVersion: CURRENT_NODE_CONTRACT_VERSION,
    portIdsStable: true,
} as const;

export const NodeContractCompatibilitySchema = z
    .object({
        minimumReaderVersion: z.number().int().positive(),
        maximumReaderVersion: z.number().int().positive(),
        /** True when persisted Edge sourcePort values remain valid without a port migration. */
        portIdsStable: z.boolean(),
    })
    .strict()
    .readonly();
export type NodeContractCompatibility = z.infer<typeof NodeContractCompatibilitySchema>;

export type NodeContractCompatibilityValidation =
    | { readonly ok: true }
    | { readonly ok: false; readonly error: string };

function compatibilityError(
    version: number,
    compatibility: NodeContractCompatibility | undefined,
    readerVersion: number,
): string | undefined {
    const policy = compatibility ?? DEFAULT_NODE_CONTRACT_COMPATIBILITY;
    if (policy.minimumReaderVersion > policy.maximumReaderVersion) {
        return 'compatibility.minimumReaderVersion must not exceed compatibility.maximumReaderVersion.';
    }
    if (version > CURRENT_NODE_CONTRACT_VERSION) {
        return `Node Contract version ${version} is not supported; the current supported version is ${CURRENT_NODE_CONTRACT_VERSION}.`;
    }
    if (readerVersion < policy.minimumReaderVersion) {
        return `Node Contract requires reader version ${policy.minimumReaderVersion}, but the current reader is version ${readerVersion}.`;
    }
    if (readerVersion > policy.maximumReaderVersion) {
        return `Node Contract supports readers through version ${policy.maximumReaderVersion}, but the current reader is version ${readerVersion}.`;
    }
    return undefined;
}

export type SerializableJsonValue =
    | string
    | number
    | boolean
    | null
    | SerializableJsonValue[]
    | { readonly [key: string]: SerializableJsonValue };

export const SerializableJsonValueSchema: z.ZodType<SerializableJsonValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(SerializableJsonValueSchema),
        z.record(z.string(), SerializableJsonValueSchema),
    ]),
);

const BuiltinNodeIdentitySchema = z
    .object({
        namespace: z.literal('builtin'),
        type: z.string().min(1),
    })
    .readonly();

const PluginNodeIdentitySchema = z
    .object({
        namespace: z.literal('plugin'),
        pluginId: z.string().min(1),
        type: z.string().min(1),
    })
    .readonly();

export const NodeIdentitySchema = z.discriminatedUnion('namespace', [
    BuiltinNodeIdentitySchema,
    PluginNodeIdentitySchema,
]);
export type NodeIdentity = z.infer<typeof NodeIdentitySchema>;

export interface NodeContractInput {
    readonly type: string;
    readonly pluginId?: string;
    readonly config: unknown;
}

export const NodeRoleSchema = z.enum(['trigger', 'action']);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const NodeCategorySchema = z.enum(['trigger', 'logic', 'system', 'state', 'utility']);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const NodeContractDisplaySchema = z
    .object({
        label: z.string().min(1),
        description: z.string(),
        category: NodeCategorySchema,
    })
    .readonly();
export type NodeContractDisplay = z.infer<typeof NodeContractDisplaySchema>;

export const NodeOutputPortSchema = z
    .object({
        id: z.string().min(1),
        label: z.string().min(1),
        /** Previous persisted port IDs or labels that may be migrated to id. */
        aliases: z.array(z.string().min(1)).readonly().optional(),
    })
    .readonly();
export type NodeOutputPort = z.infer<typeof NodeOutputPortSchema>;

const FixedOutputPortSpecSchema = z
    .object({
        kind: z.literal('fixed'),
        ports: z.array(NodeOutputPortSchema).min(1),
    })
    .strict()
    .readonly();

const ConfigDerivedOutputPortSpecSchema = z
    .object({
        kind: z.literal('config-derived'),
        strategy: z.literal('switch-cases'),
        defaultPort: NodeOutputPortSchema,
    })
    .strict()
    .readonly();

const DynamicOutputPortSpecSchema = z
    .object({
        kind: z.literal('dynamic'),
    })
    .strict()
    .readonly();

export const NodeOutputPortSpecSchema = z.discriminatedUnion('kind', [
    FixedOutputPortSpecSchema,
    ConfigDerivedOutputPortSpecSchema,
    DynamicOutputPortSpecSchema,
]);
export type NodeOutputPortSpec = z.infer<typeof NodeOutputPortSpecSchema>;

export const NodeContractSchema = z
    .object({
        identity: NodeIdentitySchema,
        version: z.number().int().positive(),
        compatibility: NodeContractCompatibilitySchema.default(DEFAULT_NODE_CONTRACT_COMPATIBILITY),
        role: NodeRoleSchema,
        defaultConfig: z.unknown(),
        outputPorts: NodeOutputPortSpecSchema,
        display: NodeContractDisplaySchema,
    })
    .strict()
    .superRefine((contract, ctx) => {
        const compatibilityIssue = compatibilityError(
            contract.version,
            contract.compatibility,
            CURRENT_NODE_CONTRACT_VERSION,
        );
        if (compatibilityIssue) {
            ctx.addIssue({
                code: 'custom',
                path: ['compatibility'],
                message: compatibilityIssue,
            });
        }

        if (contract.outputPorts.kind !== 'fixed') return;

        const seen = new Set<string>();
        const seenAliases = new Set<string>();
        for (const [index, port] of contract.outputPorts.ports.entries()) {
            if (seen.has(port.id) || seenAliases.has(port.id)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['outputPorts', 'ports', index, 'id'],
                    message: `Output port identity "${port.id}" is declared more than once.`,
                });
            }
            seen.add(port.id);

            for (const alias of port.aliases ?? []) {
                if (alias === port.id || seen.has(alias) || seenAliases.has(alias)) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['outputPorts', 'ports', index, 'aliases'],
                        message: `Output port alias "${alias}" conflicts with another port identity.`,
                    });
                }
                seenAliases.add(alias);
            }
        }
    })
    .readonly();
/** Input form intentionally permits omitted compatibility for legacy contracts. */
export type NodeContract = z.input<typeof NodeContractSchema>;
export type ParsedNodeContract = z.output<typeof NodeContractSchema>;

/**
 * The contract representation that may cross a worker or Electron Bridge.
 * Runtime config schemas, output-port functions, and UI components are
 * intentionally not part of this value.
 */
export const SerializableNodeContractSchema = NodeContractSchema.superRefine((contract, ctx) => {
    const parsedDefault = SerializableJsonValueSchema.safeParse(contract.defaultConfig);
    if (!parsedDefault.success) {
        ctx.addIssue({
            code: 'custom',
            path: ['defaultConfig'],
            message: 'Node Contract defaultConfig must contain JSON-serializable data only.',
        });
    }

    const resolvedDefault = resolveDeclarativeOutputPorts(
        contract.outputPorts,
        contract.defaultConfig,
    );
    if (!resolvedDefault.ok) {
        for (const issue of resolvedDefault.issues) {
            ctx.addIssue({
                code: 'custom',
                path: ['defaultConfig', ...issue.path.split('.').filter(Boolean)],
                message: issue.message,
            });
        }
    }
});
/** Input form intentionally permits omitted compatibility for legacy manifests. */
export type SerializableNodeContractInput = z.input<typeof SerializableNodeContractSchema>;
export type SerializableNodeContract = z.output<typeof SerializableNodeContractSchema>;
export const NodeContractSnapshotSchema = SerializableNodeContractSchema;
export type NodeContractSnapshot = SerializableNodeContract;
export const NodeContractSnapshotListSchema = z.array(NodeContractSnapshotSchema).readonly();

export type PluginNodeContractValidation =
    | { readonly ok: true; readonly contract: SerializableNodeContract }
    | { readonly ok: false; readonly error: string };

export function validateNodeContractCompatibility(
    contract: Pick<NodeContract, 'version' | 'compatibility'>,
    readerVersion: number = CURRENT_NODE_CONTRACT_VERSION,
): NodeContractCompatibilityValidation {
    const parsedCompatibility = NodeContractCompatibilitySchema.safeParse(
        contract.compatibility ?? DEFAULT_NODE_CONTRACT_COMPATIBILITY,
    );
    if (!parsedCompatibility.success) {
        return {
            ok: false,
            error: parsedCompatibility.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; '),
        };
    }

    const error = compatibilityError(contract.version, parsedCompatibility.data, readerVersion);
    return error === undefined ? { ok: true } : { ok: false, error };
}

export function validatePluginNodeContract(
    unknown: unknown,
    pluginId: string,
    nodeType: string,
): PluginNodeContractValidation {
    const parsed = SerializableNodeContractSchema.safeParse(unknown);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; '),
        };
    }

    const { identity } = parsed.data;
    if (identity.namespace !== 'plugin') {
        return {
            ok: false,
            error: 'Plugin Node Contracts must use the "plugin" identity namespace.',
        };
    }
    if (identity.pluginId !== pluginId) {
        return {
            ok: false,
            error:
                `Plugin Node Contract identity pluginId "${identity.pluginId}" does not match ` +
                `manifest id "${pluginId}".`,
        };
    }
    if (identity.type !== nodeType) {
        return {
            ok: false,
            error:
                `Plugin Node Contract identity type "${identity.type}" does not match ` +
                `manifest nodeType "${nodeType}".`,
        };
    }
    if (identity.namespace === 'plugin' && parsed.data.version > CURRENT_NODE_CONTRACT_VERSION) {
        return {
            ok: false,
            error:
                `Plugin Node Contract version ${parsed.data.version} is not supported; ` +
                `the current supported version is ${CURRENT_NODE_CONTRACT_VERSION}.`,
        };
    }

    return { ok: true, contract: parsed.data };
}

export const NodeContractIssueCodeSchema = z.enum(['invalid_configuration', 'invalid_contract']);
export type NodeContractIssueCode = z.infer<typeof NodeContractIssueCodeSchema>;

export const NodeContractIssueSchema = z
    .object({
        code: NodeContractIssueCodeSchema,
        path: z.string(),
        message: z.string().min(1),
        repairHint: z.string().min(1).optional(),
    })
    .readonly();
export type NodeContractIssue = z.infer<typeof NodeContractIssueSchema>;

export type NodeContractResolution =
    | {
          readonly status: 'available';
          readonly identity: NodeIdentity;
          readonly contract: NodeContract;
          readonly config: unknown;
          readonly outputPorts: readonly NodeOutputPort[] | 'dynamic';
      }
    | {
          readonly status: 'unavailable';
          readonly identity: NodeIdentity;
          readonly reason: 'unregistered';
      }
    | {
          readonly status: 'invalid';
          readonly identity: NodeIdentity;
          readonly contract: NodeContract;
          readonly issues: readonly NodeContractIssue[];
          /** Present when port identities can still be derived from the invalid draft. */
          readonly outputPorts?: readonly NodeOutputPort[] | 'dynamic';
      };

export interface NodeContractRegistration<TSchema extends z.ZodType = z.ZodType> {
    readonly contract: NodeContract;
    readonly configSchema: TSchema;
    /** Compatibility hook for descriptors while their output logic migrates. */
    readonly resolveOutputPorts?: (
        config: z.output<TSchema>,
    ) => readonly NodeOutputPort[] | 'dynamic';
    readonly validateConfig?: (config: z.output<TSchema>) => readonly NodeContractIssue[];
}

export interface NodeContractRegistry {
    readonly register: (registration: NodeContractRegistration) => void;
    readonly unregister: (identity: NodeIdentity) => void;
    readonly get: (identity: NodeIdentity) => NodeContract | undefined;
    readonly has: (identity: NodeIdentity) => boolean;
    readonly all: () => readonly NodeContract[];
    readonly resolve: (node: NodeContractInput) => NodeContractResolution;
    readonly resolveIdentity: (identity: NodeIdentity, config: unknown) => NodeContractResolution;
}

export function builtinNodeIdentity(type: string): NodeIdentity {
    return { namespace: 'builtin', type };
}

export function pluginNodeIdentity(pluginId: string, type: string): NodeIdentity {
    return { namespace: 'plugin', pluginId, type };
}

export function nodeIdentityForNode(
    node: Pick<NodeContractInput, 'type' | 'pluginId'>,
): NodeIdentity {
    return node.pluginId === undefined
        ? builtinNodeIdentity(node.type)
        : pluginNodeIdentity(node.pluginId, node.type);
}

/** A collision-free key for registry storage. Use formatNodeIdentity for diagnostics. */
export function nodeIdentityKey(identity: NodeIdentity): string {
    return JSON.stringify([
        identity.namespace,
        identity.namespace === 'plugin' ? identity.pluginId : '',
        identity.type,
    ]);
}

export function formatNodeIdentity(identity: NodeIdentity): string {
    return identity.namespace === 'builtin'
        ? `builtin:${identity.type}`
        : `plugin:${identity.pluginId}:${identity.type}`;
}

export function fixedOutputPort(
    id: string,
    label = id,
    aliases: readonly string[] = [],
): NodeOutputPort {
    return aliases.length > 0 ? { id, label, aliases: [...aliases] } : { id, label };
}

export type OutputPortIdResolution =
    | { readonly ok: true; readonly portId: string; readonly matchedBy: 'id' | 'alias' }
    | { readonly ok: false; readonly reason: 'unknown' };

/** Resolve a persisted Edge value without making display labels topology. */
export function resolveOutputPortId(
    ports: readonly NodeOutputPort[],
    persistedPortId: string,
): OutputPortIdResolution {
    const direct = ports.find((port) => port.id === persistedPortId);
    if (direct) return { ok: true, portId: direct.id, matchedBy: 'id' };

    const alias = ports.find((port) => port.aliases?.includes(persistedPortId) === true);
    return alias
        ? { ok: true, portId: alias.id, matchedBy: 'alias' }
        : { ok: false, reason: 'unknown' };
}

export function fixedOutputPortSpec(
    ports: readonly NodeOutputPort[] | readonly string[],
): NodeOutputPortSpec {
    return {
        kind: 'fixed',
        ports: ports.map((port) => (typeof port === 'string' ? fixedOutputPort(port) : port)),
    };
}

export function switchOutputPortSpec(
    defaultPort: NodeOutputPort = fixedOutputPort(SWITCH_DEFAULT_PORT),
): NodeOutputPortSpec {
    return {
        kind: 'config-derived',
        strategy: 'switch-cases',
        defaultPort,
    };
}

function zodIssues(error: z.ZodError): readonly NodeContractIssue[] {
    return error.issues.map((issue) => ({
        code: 'invalid_configuration',
        path: issue.path.map(String).join('.'),
        message: issue.message,
    }));
}

function switchConfigIssues(config: SwitchConfig): readonly NodeContractIssue[] {
    return validateSwitchConfig(config).map((diagnostic) => ({
        code: 'invalid_configuration',
        path:
            diagnostic.code === 'duplicate_case_id' || diagnostic.code === 'reserved_case_id'
                ? `cases[${diagnostic.caseIndex}].id`
                : `cases[${diagnostic.caseIndex}].value`,
        message: diagnostic.message,
        repairHint: diagnostic.repairHint,
    }));
}

export type DeclarativeOutputPortResolution =
    | { readonly ok: true; readonly value: readonly NodeOutputPort[] | 'dynamic' }
    | {
          readonly ok: false;
          readonly issues: readonly NodeContractIssue[];
          readonly outputPorts?: readonly NodeOutputPort[] | 'dynamic';
      };

export function resolveDeclarativeOutputPorts(
    spec: NodeOutputPortSpec,
    config: unknown,
): DeclarativeOutputPortResolution {
    switch (spec.kind) {
        case 'fixed':
            return { ok: true, value: spec.ports };
        case 'dynamic':
            return { ok: true, value: 'dynamic' };
        case 'config-derived': {
            const parsed = SwitchConfigSchema.safeParse(config);
            if (!parsed.success) {
                return { ok: false, issues: zodIssues(parsed.error) };
            }

            const configIssues = switchConfigIssues(parsed.data);
            const reservedDefaultIssues =
                spec.defaultPort.id === SWITCH_DEFAULT_PORT
                    ? []
                    : parsed.data.cases.flatMap((switchCase, caseIndex) =>
                          switchCase.id === spec.defaultPort.id
                              ? [
                                    {
                                        code: 'invalid_configuration' as const,
                                        path: `cases[${caseIndex}].id`,
                                        message:
                                            `Switch case identity "${switchCase.id}" is reserved for the ` +
                                            'default output port.',
                                        repairHint:
                                            'Use a different case identity so the fallback output remains stable.',
                                    },
                                ]
                              : [],
                      );
            const issues = [...configIssues, ...reservedDefaultIssues];
            const outputPorts = [
                spec.defaultPort,
                ...parsed.data.cases.map((switchCase) => ({
                    id: switchCase.id,
                    label: switchCase.value || '(empty)',
                })),
            ];
            if (issues.length > 0) {
                const hasUnresolvableIdentity = issues.some((issue) => issue.path.endsWith('.id'));
                return {
                    ok: false,
                    issues,
                    ...(hasUnresolvableIdentity ? {} : { outputPorts }),
                };
            }

            return { ok: true, value: outputPorts };
        }
        default:
            return assertNever(spec);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Node Contract case: ${JSON.stringify(value)}`);
}

function resolveRegistration(
    registration: NodeContractRegistration,
    identity: NodeIdentity,
    config: unknown,
): NodeContractResolution {
    const parsed = registration.configSchema.safeParse(config);
    if (!parsed.success) {
        return {
            status: 'invalid',
            identity,
            contract: registration.contract,
            issues: zodIssues(parsed.error),
        };
    }

    const resolved = registration.resolveOutputPorts
        ? { ok: true as const, value: registration.resolveOutputPorts(parsed.data) }
        : resolveDeclarativeOutputPorts(registration.contract.outputPorts, parsed.data);

    const customIssues = registration.validateConfig?.(parsed.data) ?? [];
    if (!resolved.ok) {
        return {
            status: 'invalid',
            identity,
            contract: registration.contract,
            issues: [...customIssues, ...resolved.issues],
            ...(resolved.outputPorts === undefined ? {} : { outputPorts: resolved.outputPorts }),
        };
    }
    if (customIssues.length > 0) {
        return {
            status: 'invalid',
            identity,
            contract: registration.contract,
            issues: customIssues,
            outputPorts: resolved.value,
        };
    }

    return {
        status: 'available',
        identity,
        contract: registration.contract,
        config: parsed.data,
        outputPorts: resolved.value,
    };
}

export function createNodeContractRegistry(
    registrations: readonly NodeContractRegistration[] = [],
): NodeContractRegistry {
    const byIdentity = new Map<string, NodeContractRegistration>();

    const register = (registration: NodeContractRegistration): void => {
        const parsedContract = NodeContractSchema.safeParse(registration.contract);
        if (!parsedContract.success) {
            throw new Error(
                `Invalid Node Contract: ${parsedContract.error.issues.map((issue) => issue.message).join('; ')}`,
            );
        }

        const defaultConfig = registration.configSchema.safeParse(
            parsedContract.data.defaultConfig,
        );
        if (!defaultConfig.success) {
            throw new Error(
                `Invalid default configuration for ${formatNodeIdentity(parsedContract.data.identity)}: ${defaultConfig.error.message}`,
            );
        }

        if (!registration.resolveOutputPorts) {
            const defaultPorts = resolveDeclarativeOutputPorts(
                parsedContract.data.outputPorts,
                defaultConfig.data,
            );
            if (!defaultPorts.ok) {
                throw new Error(
                    `Invalid default output-port configuration for ${formatNodeIdentity(parsedContract.data.identity)}: ${defaultPorts.issues.map((issue) => issue.message).join('; ')}`,
                );
            }
        }

        const key = nodeIdentityKey(parsedContract.data.identity);
        if (byIdentity.has(key)) {
            throw new Error(
                `Node Contract already registered for ${formatNodeIdentity(parsedContract.data.identity)}.`,
            );
        }

        byIdentity.set(key, { ...registration, contract: parsedContract.data });
    };

    registrations.forEach(register);

    const resolveIdentity = (identity: NodeIdentity, config: unknown): NodeContractResolution => {
        const registration = byIdentity.get(nodeIdentityKey(identity));
        if (!registration) {
            return { status: 'unavailable', identity, reason: 'unregistered' };
        }
        return resolveRegistration(registration, identity, config);
    };

    return {
        register,
        unregister: (identity) => {
            byIdentity.delete(nodeIdentityKey(identity));
        },
        get: (identity) => byIdentity.get(nodeIdentityKey(identity))?.contract,
        has: (identity) => byIdentity.has(nodeIdentityKey(identity)),
        all: () =>
            Object.freeze([...byIdentity.values()].map((registration) => registration.contract)),
        resolve: (node) => resolveIdentity(nodeIdentityForNode(node), node.config),
        resolveIdentity,
    };
}

/** Register a validated serializable contract without importing a runtime config schema. */
export function registerSerializableNodeContract(
    registry: NodeContractRegistry,
    contract: SerializableNodeContractInput,
): void {
    registry.register({
        contract,
        configSchema: z.unknown(),
    });
}

export function resolveNodeContract(
    node: NodeContractInput,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): NodeContractResolution {
    return registry.resolve(node);
}

export function outputPortDescriptorsForNode(
    node: NodeContractInput,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): readonly NodeOutputPort[] | 'dynamic' {
    const result = resolveNodeContract(node, registry);
    if (result.status === 'available') return result.outputPorts;
    if (result.status === 'invalid') return result.outputPorts ?? [];
    return [];
}

export function outputPortIdsForNode(
    node: NodeContractInput,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): readonly string[] | 'dynamic' {
    const ports = outputPortDescriptorsForNode(node, registry);
    return ports === 'dynamic' ? 'dynamic' : ports.map((port) => port.id);
}

export function outputPortLabelForNode(
    node: NodeContractInput,
    portId: string,
    registry: NodeContractRegistry = BUILTIN_NODE_CONTRACT_REGISTRY,
): string {
    const ports = outputPortDescriptorsForNode(node, registry);
    if (ports === 'dynamic') return portId;
    return ports.find((port) => port.id === portId)?.label ?? portId;
}

export interface NodeDescriptorAdapterOptions {
    readonly namespace?: NodeNamespace;
    readonly pluginId?: string;
    readonly role?: NodeRole;
    readonly display?: Partial<NodeContractDisplay>;
    readonly outputPortLabel?: (config: unknown, portId: string) => string;
}

/**
 * @deprecated Compatibility Adapter for descriptor-shaped registrations during
 * migration. The declarative contract is marked dynamic because descriptor
 * functions are not serializable; the registry still resolves their concrete
 * ports in-process.
 */
export function adaptNodeDescriptor<TType extends string, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
    options: NodeDescriptorAdapterOptions = {},
): NodeContractRegistration<TSchema> {
    const namespace = options.namespace ?? 'builtin';
    const identity =
        namespace === 'plugin'
            ? pluginNodeIdentity(options.pluginId ?? '', descriptor.type)
            : builtinNodeIdentity(descriptor.type);

    return {
        contract: {
            identity,
            version: 1,
            role: options.role ?? 'action',
            defaultConfig: descriptor.defaultConfig,
            outputPorts: { kind: 'dynamic' },
            display: {
                label: options.display?.label ?? descriptor.type,
                description: options.display?.description ?? '',
                category: options.display?.category ?? 'utility',
            },
        },
        configSchema: descriptor.configSchema,
        resolveOutputPorts: (config) =>
            descriptor.getOutputPorts(config).map((port) => ({
                id: port,
                label: options.outputPortLabel?.(config, port) ?? port,
            })),
    };
}

export const BUILTIN_NODE_TYPE_VALUES = [
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

export type NodeType = (typeof BUILTIN_NODE_TYPE_VALUES)[number];

export const BUILTIN_NODE_DESCRIPTORS = {
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

type BuiltinRegistrationOptions = {
    readonly role: NodeRole;
    readonly outputPorts: NodeOutputPortSpec;
    readonly display: NodeContractDisplay;
    readonly validateConfig?: (config: never) => readonly NodeContractIssue[];
};

function builtinRegistration<TType extends NodeType, TSchema extends z.ZodType>(
    descriptor: NodeDescriptor<TType, TSchema>,
    options: Omit<BuiltinRegistrationOptions, 'validateConfig'> & {
        readonly validateConfig?: (config: z.output<TSchema>) => readonly NodeContractIssue[];
    },
): NodeContractRegistration<TSchema> {
    return {
        contract: {
            identity: builtinNodeIdentity(descriptor.type),
            version: 1,
            role: options.role,
            defaultConfig: descriptor.defaultConfig,
            outputPorts: options.outputPorts,
            display: options.display,
        },
        configSchema: descriptor.configSchema,
        ...(options.validateConfig ? { validateConfig: options.validateConfig } : {}),
    };
}

const OUT_PORTS = fixedOutputPortSpec([fixedOutputPort('out', 'Output', ['Output'])]);

export const BUILTIN_NODE_CONTRACT_REGISTRATIONS: readonly NodeContractRegistration[] = [
    builtinRegistration(FileWatcherDescriptor, {
        role: 'trigger',
        outputPorts: OUT_PORTS,
        display: {
            label: 'File Watcher',
            description:
                'Emits an event when files are created, modified, or deleted in a watched path.',
            category: 'trigger',
        },
    }),
    builtinRegistration(ManualTriggerDescriptor, {
        role: 'trigger',
        outputPorts: OUT_PORTS,
        display: {
            label: 'Manual Trigger',
            description:
                'Fires a single event with a hand-crafted payload, for testing and manual runs.',
            category: 'trigger',
        },
    }),
    builtinRegistration(IfElseDescriptor, {
        role: 'action',
        outputPorts: fixedOutputPortSpec(['true', 'false']),
        display: {
            label: 'If / Else',
            description: 'Branches the flow down a true or false path based on a condition.',
            category: 'logic',
        },
    }),
    builtinRegistration(SwitchDescriptor, {
        role: 'action',
        outputPorts: switchOutputPortSpec(),
        display: {
            label: 'Switch',
            description:
                'Routes the flow to one of several cases (plus default) by event name or field value.',
            category: 'logic',
        },
    }),
    builtinRegistration(FileManagerDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'File Manager',
            description: 'Moves, renames, or copies the file carried by the incoming event.',
            category: 'system',
        },
    }),
    builtinRegistration(NotificationDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'Notification',
            description: 'Shows an OS notification with a title and body.',
            category: 'system',
        },
    }),
    builtinRegistration(StateGetDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'State Get',
            description: 'Loads a value from workflow state into the workflow variables.',
            category: 'state',
        },
    }),
    builtinRegistration(StateSetDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'State Set',
            description: 'Writes a templated value into workflow state under a key.',
            category: 'state',
        },
    }),
    builtinRegistration(LogDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'Log',
            description: 'Emits a log line with a templated message.',
            category: 'utility',
        },
    }),
    builtinRegistration(DelayDescriptor, {
        role: 'action',
        outputPorts: OUT_PORTS,
        display: {
            label: 'Delay',
            description: 'Pauses the flow for a number of milliseconds.',
            category: 'utility',
        },
    }),
];

export function createBuiltinNodeContractRegistry(): NodeContractRegistry {
    return createNodeContractRegistry(BUILTIN_NODE_CONTRACT_REGISTRATIONS);
}

export const BUILTIN_NODE_CONTRACT_REGISTRY = createBuiltinNodeContractRegistry();

export function getNodeDescriptor<K extends NodeType>(
    type: K,
): (typeof BUILTIN_NODE_DESCRIPTORS)[K] {
    return BUILTIN_NODE_DESCRIPTORS[type];
}

export function getBuiltinNodeContract(type: NodeType): NodeContract {
    const contract = BUILTIN_NODE_CONTRACT_REGISTRY.get(builtinNodeIdentity(type));
    if (!contract) throw new Error(`Missing built-in Node Contract for "${type}".`);
    return contract;
}
