import { NodeOutputPortIdSchema, NodeTypeNameSchema, type PluginId } from '@sigil/contracts/ids';

import {
    type NodeContract,
    type NodeContractDefinition,
    type NodeContractInput,
    type NodeContractIssue,
    NodeContractSchema,
    type NodeIdentity,
    type NodeOutputPort,
    type NodeOutputPortId,
    type NodeOutputPortInput,
    type NodeOutputPortSpec,
    type NodeOutputPortSpecInput,
    normalizeNodeConfigurationSchema,
    type SerializableNodeContractInput,
} from '@sigil/contracts/node-contract';
import { fromJSONSchema, type z } from 'zod';

export type {
    NodeContract,
    NodeContractDefinition,
    NodeContractInput,
    NodeContractIssue,
    NodeIdentity,
    NodeOutputPort,
    NodeOutputPortId,
    NodeOutputPortInput,
    NodeOutputPortSpec,
    NodeOutputPortSpecInput,
    SerializableNodeContract,
    SerializableNodeContractInput,
} from '@sigil/contracts/node-contract';

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
          readonly outputPorts?: readonly NodeOutputPort[] | 'dynamic';
      };

export interface NodeContractRegistration<TSchema extends z.ZodType = z.ZodType> {
    readonly contract: NodeContractDefinition;
    readonly configSchema: TSchema;
    readonly validateConfig?: (config: z.output<TSchema>) => readonly NodeContractIssue[];
    readonly resolveOutputPorts?: (config: z.output<TSchema>) => DeclarativeOutputPortResolution;
}

export type OutputPortStrategy = (
    spec: Extract<NodeOutputPortSpecInput, { readonly kind: 'config-derived' }>,
    config: unknown,
) => DeclarativeOutputPortResolution;

export interface NodeContractRegistryOptions {
    readonly outputPortStrategies?: Readonly<Record<string, OutputPortStrategy>>;
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
    return { namespace: 'builtin', type: NodeTypeNameSchema.parse(type) };
}

export function pluginNodeIdentity(pluginId: PluginId, type: string): NodeIdentity {
    return { namespace: 'plugin', pluginId, type: NodeTypeNameSchema.parse(type) };
}

export function nodeIdentityForNode(
    node: Pick<NodeContractInput, 'type' | 'pluginId'>,
): NodeIdentity {
    return node.pluginId === undefined
        ? builtinNodeIdentity(node.type)
        : pluginNodeIdentity(node.pluginId, node.type);
}

/** A collision-free registry key; use formatNodeIdentity for diagnostics. */
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

export function fixedOutputPort(id: string, label = id): NodeOutputPort {
    const parsedId = NodeOutputPortIdSchema.parse(id);
    return { id: parsedId, label };
}

export function fixedOutputPortSpec(
    ports: readonly NodeOutputPortInput[] | readonly string[],
): NodeOutputPortSpec {
    return {
        kind: 'fixed',
        ports: ports.map((port) =>
            typeof port === 'string' ? fixedOutputPort(port) : fixedOutputPort(port.id, port.label),
        ),
    };
}

function normalizeOutputPort(port: NodeOutputPortInput): NodeOutputPort {
    return fixedOutputPort(port.id, port.label);
}

function zodIssues(error: z.ZodError): readonly NodeContractIssue[] {
    return error.issues.map((issue) => ({
        code: 'invalid_configuration',
        path: issue.path.map(String).join('.'),
        message: issue.message,
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
    spec: NodeOutputPortSpecInput,
    config: unknown,
    outputPortStrategies: Readonly<Record<string, OutputPortStrategy>> = {},
): DeclarativeOutputPortResolution {
    switch (spec.kind) {
        case 'fixed':
            return { ok: true, value: spec.ports.map(normalizeOutputPort) };
        case 'dynamic':
            return { ok: true, value: 'dynamic' };
        case 'config-derived': {
            const strategy = outputPortStrategies[spec.strategy];
            if (!strategy) {
                return {
                    ok: false,
                    issues: [
                        {
                            code: 'invalid_contract',
                            path: 'outputPorts.strategy',
                            message: `No output-port strategy is registered for "${spec.strategy}".`,
                            repairHint:
                                'Register the strategy adapter before admitting this Node Contract.',
                        },
                    ],
                };
            }
            return strategy(spec, config);
        }
        default:
            return assertNever(spec);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Node Contract case: ${JSON.stringify(value)}`);
}

function resolveRegistration(
    registration: Omit<NodeContractRegistration, 'contract'> & { readonly contract: NodeContract },
    identity: NodeIdentity,
    config: unknown,
    outputPortStrategies: Readonly<Record<string, OutputPortStrategy>>,
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
        ? registration.resolveOutputPorts(parsed.data)
        : resolveDeclarativeOutputPorts(
              registration.contract.outputPorts,
              parsed.data,
              outputPortStrategies,
          );
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
    options: NodeContractRegistryOptions = {},
): NodeContractRegistry {
    type RegisteredNodeContract = Omit<NodeContractRegistration, 'contract'> & {
        readonly contract: NodeContract;
    };

    const byIdentity = new Map<string, RegisteredNodeContract>();

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

        const defaultPorts = registration.resolveOutputPorts
            ? registration.resolveOutputPorts(defaultConfig.data)
            : resolveDeclarativeOutputPorts(
                  parsedContract.data.outputPorts,
                  defaultConfig.data,
                  options.outputPortStrategies,
              );
        if (!defaultPorts.ok) {
            throw new Error(
                `Invalid default output-port configuration for ${formatNodeIdentity(parsedContract.data.identity)}: ${defaultPorts.issues.map((issue) => issue.message).join('; ')}`,
            );
        }

        const defaultConfigIssues = registration.validateConfig?.(defaultConfig.data) ?? [];
        if (defaultConfigIssues.length > 0) {
            throw new Error(
                `Invalid default configuration for ${formatNodeIdentity(parsedContract.data.identity)}: ${defaultConfigIssues.map((issue) => issue.message).join('; ')}`,
            );
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
        if (!registration) return { status: 'unavailable', identity, reason: 'unregistered' };
        return resolveRegistration(
            registration,
            identity,
            config,
            options.outputPortStrategies ?? {},
        );
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

/** Register a wire contract at the domain registry without runtime code. */
export function registerSerializableNodeContract(
    registry: NodeContractRegistry,
    contract: SerializableNodeContractInput,
): void {
    const configSchema = reconstructNodeConfigurationSchema(contract.configSchema);
    registry.register({ contract, configSchema });
}

/** Reconstruct the host validator from a serializable Plugin Node contract. */
export function reconstructNodeConfigurationSchema(value: unknown): z.ZodType {
    const normalized = normalizeNodeConfigurationSchema(value);
    try {
        return fromJSONSchema(normalized.schema);
    } catch (error) {
        throw new Error(
            `Plugin Node configuration schema could not be reconstructed for ${normalized.dialect}: ${String(error)}`,
        );
    }
}

export function resolveNodeContract(
    node: NodeContractInput,
    registry: NodeContractRegistry,
): NodeContractResolution {
    return registry.resolve(node);
}

export function outputPortDescriptorsForNode(
    node: NodeContractInput,
    registry: NodeContractRegistry,
): readonly NodeOutputPort[] | 'dynamic' {
    const result = resolveNodeContract(node, registry);
    if (result.status === 'available') return result.outputPorts;
    if (result.status === 'invalid') return result.outputPorts ?? [];
    return [];
}

export function outputPortIdsForNode(
    node: NodeContractInput,
    registry: NodeContractRegistry,
): readonly NodeOutputPortId[] | 'dynamic' {
    const ports = outputPortDescriptorsForNode(node, registry);
    return ports === 'dynamic' ? 'dynamic' : ports.map((port) => port.id);
}

export function outputPortLabelForNode(
    node: NodeContractInput,
    portId: string,
    registry: NodeContractRegistry,
): string {
    const ports = outputPortDescriptorsForNode(node, registry);
    if (ports === 'dynamic') return portId;
    return ports.find((port) => port.id === portId)?.label ?? portId;
}
