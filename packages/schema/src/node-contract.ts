import { z } from 'zod';

import {
    type NodeOutputPortId,
    NodeOutputPortIdSchema,
    NodeTypeNameSchema,
    type PluginId,
    PluginIdSchema,
} from './ids.js';

export const NodeNamespaceSchema = z.enum(['builtin', 'plugin']);
export type NodeNamespace = z.infer<typeof NodeNamespaceSchema>;

/**
 * The registry intentionally admits only this exact version. A future
 * version must be introduced with an explicit migration/admission seam; the
 * generic contract kernel does not silently reinterpret older contracts.
 */
export const CURRENT_NODE_CONTRACT_VERSION = 1 as const;

export type SerializableJsonValue =
    | string
    | number
    | boolean
    | null
    | SerializableJsonValue[]
    | { readonly [key: string]: SerializableJsonValue };

/**
 * Complexity limits for serializable Plugin Node Contract data.
 *
 * Depth starts at zero for the contract root. Value count includes the root
 * and every array element or object property value, but not object keys.
 * Collection length is the number of array elements or enumerable object
 * properties. String length is measured in UTF-16 code units, matching
 * JavaScript's `string.length`.
 */
export interface SerializableNodeContractComplexityLimits {
    readonly maxDepth: number;
    readonly maxValueCount: number;
    readonly maxCollectionLength: number;
    readonly maxStringLength: number;
}

export const SERIALIZABLE_NODE_CONTRACT_COMPLEXITY_LIMITS = Object.freeze({
    maxDepth: 16,
    maxValueCount: 512,
    maxCollectionLength: 128,
    maxStringLength: 4096,
} as const) satisfies SerializableNodeContractComplexityLimits;

export type SerializableJsonPath = readonly (string | number)[];

export type SerializableJsonComplexityFailure =
    | { readonly kind: 'cycle' | 'unreadable'; readonly path: SerializableJsonPath }
    | {
          readonly kind:
              | 'max-depth'
              | 'max-value-count'
              | 'max-collection-length'
              | 'max-string-length';
          readonly path: SerializableJsonPath;
          readonly limit: number;
      };

export type SerializableJsonComplexityResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: SerializableJsonComplexityFailure };

type SerializableJsonBudgetFailureKind =
    | 'max-depth'
    | 'max-value-count'
    | 'max-collection-length'
    | 'max-string-length';

interface SerializableJsonEnterFrame {
    readonly kind: 'enter';
    readonly value: unknown;
    readonly depth: number;
    readonly path: SerializableJsonPath;
}

interface SerializableJsonExitFrame {
    readonly kind: 'exit';
    readonly value: object;
}

type SerializableJsonFrame = SerializableJsonEnterFrame | SerializableJsonExitFrame;

function isObjectValue(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

function isRecordObject(value: object): value is Record<string, unknown> {
    try {
        return !Array.isArray(value);
    } catch {
        return false;
    }
}

function complexityFailure(
    kind: 'cycle' | 'unreadable',
    path: SerializableJsonPath,
): SerializableJsonComplexityResult;
function complexityFailure(
    kind: SerializableJsonBudgetFailureKind,
    path: SerializableJsonPath,
    limit: number,
): SerializableJsonComplexityResult;
function complexityFailure(
    kind: SerializableJsonComplexityFailure['kind'],
    path: SerializableJsonPath,
    limit?: number,
): SerializableJsonComplexityResult {
    if (kind === 'cycle' || kind === 'unreadable') {
        return { ok: false, failure: { kind, path } };
    }
    return { ok: false, failure: { kind, path, limit: limit ?? 0 } };
}

/**
 * Iteratively inspects a value before any recursive Zod traversal. The
 * active-path set rejects cycles while still allowing the same plain value to
 * appear in separate branches of an otherwise acyclic input.
 */
export function checkSerializableJsonComplexity(
    value: unknown,
    limits: SerializableNodeContractComplexityLimits = SERIALIZABLE_NODE_CONTRACT_COMPLEXITY_LIMITS,
): SerializableJsonComplexityResult {
    const frames: SerializableJsonFrame[] = [{ kind: 'enter', value, depth: 0, path: [] }];
    const activeValues = new WeakSet<object>();
    let valueCount = 0;

    while (frames.length > 0) {
        const frame = frames.pop();
        if (frame === undefined) break;

        if (frame.kind === 'exit') {
            activeValues.delete(frame.value);
            continue;
        }

        if (frame.depth > limits.maxDepth) {
            return complexityFailure('max-depth', frame.path, limits.maxDepth);
        }

        valueCount += 1;
        if (valueCount > limits.maxValueCount) {
            return complexityFailure('max-value-count', frame.path, limits.maxValueCount);
        }

        if (typeof frame.value === 'string') {
            if (frame.value.length > limits.maxStringLength) {
                return complexityFailure('max-string-length', frame.path, limits.maxStringLength);
            }
            continue;
        }

        if (!isObjectValue(frame.value)) continue;

        let arrayValue: readonly unknown[] | undefined;
        try {
            arrayValue = Array.isArray(frame.value) ? frame.value : undefined;
        } catch {
            return complexityFailure('unreadable', frame.path);
        }

        if (activeValues.has(frame.value)) {
            return complexityFailure('cycle', frame.path);
        }
        activeValues.add(frame.value);
        frames.push({ kind: 'exit', value: frame.value });

        if (arrayValue !== undefined) {
            let length: number;
            try {
                length = arrayValue.length;
            } catch {
                return complexityFailure('unreadable', frame.path);
            }
            if (length > limits.maxCollectionLength) {
                return complexityFailure(
                    'max-collection-length',
                    frame.path,
                    limits.maxCollectionLength,
                );
            }
            for (let index = length - 1; index >= 0; index -= 1) {
                try {
                    frames.push({
                        kind: 'enter',
                        value: arrayValue[index],
                        depth: frame.depth + 1,
                        path: [...frame.path, index],
                    });
                } catch {
                    return complexityFailure('unreadable', [...frame.path, index]);
                }
            }
            continue;
        }

        if (!isRecordObject(frame.value)) continue;
        const recordValue = frame.value;
        let keys: readonly string[];
        try {
            keys = Object.keys(recordValue);
        } catch {
            return complexityFailure('unreadable', frame.path);
        }
        if (keys.length > limits.maxCollectionLength) {
            return complexityFailure(
                'max-collection-length',
                frame.path,
                limits.maxCollectionLength,
            );
        }

        for (let index = keys.length - 1; index >= 0; index -= 1) {
            const key = keys[index];
            const childPath = [...frame.path, key];
            if (key.length > limits.maxStringLength) {
                return complexityFailure('max-string-length', childPath, limits.maxStringLength);
            }
            try {
                const descriptor = Object.getOwnPropertyDescriptor(recordValue, key);
                if (descriptor !== undefined && !('value' in descriptor)) {
                    return complexityFailure('unreadable', childPath);
                }
                frames.push({
                    kind: 'enter',
                    value: recordValue[key],
                    depth: frame.depth + 1,
                    path: childPath,
                });
            } catch {
                return complexityFailure('unreadable', childPath);
            }
        }
    }

    return { ok: true };
}

function complexityFailureMessage(
    failure: SerializableJsonComplexityFailure,
    subject: string,
): string {
    switch (failure.kind) {
        case 'cycle':
            return `${subject} contains a cyclic value.`;
        case 'unreadable':
            return `${subject} could not be traversed safely.`;
        case 'max-depth':
            return `${subject} exceeds the maximum depth of ${failure.limit}.`;
        case 'max-value-count':
            return `${subject} exceeds the aggregate value-count limit of ${failure.limit}.`;
        case 'max-collection-length':
            return `${subject} exceeds the collection-length limit of ${failure.limit}.`;
        case 'max-string-length':
            return `${subject} exceeds the string-length limit of ${failure.limit}.`;
        default:
            return assertNever(failure);
    }
}

const SerializableJsonValueSchemaImplementation: z.ZodType<SerializableJsonValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(SerializableJsonValueSchemaImplementation),
        z.record(z.string(), SerializableJsonValueSchemaImplementation),
    ]),
);

export const SerializableJsonValueSchema: z.ZodType<SerializableJsonValue> = z.preprocess(
    (value, ctx) => {
        const complexity = checkSerializableJsonComplexity(value);
        if (!complexity.ok) {
            ctx.addIssue({
                code: 'custom',
                path: [...complexity.failure.path],
                message: complexityFailureMessage(complexity.failure, 'Serializable JSON value'),
            });
            return undefined;
        }
        return value;
    },
    SerializableJsonValueSchemaImplementation,
);

const BuiltinNodeIdentitySchema = z
    .object({
        namespace: z.literal('builtin'),
        type: NodeTypeNameSchema,
    })
    .strict()
    .readonly();

const PluginNodeIdentitySchema = z
    .object({
        namespace: z.literal('plugin'),
        pluginId: PluginIdSchema,
        type: NodeTypeNameSchema,
    })
    .strict()
    .readonly();

export const NodeIdentitySchema = z.discriminatedUnion('namespace', [
    BuiltinNodeIdentitySchema,
    PluginNodeIdentitySchema,
]);
export type NodeIdentity = z.infer<typeof NodeIdentitySchema>;

export interface NodeContractInput {
    readonly type: string;
    readonly pluginId?: PluginId;
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
    .strict()
    .readonly();
export type NodeContractDisplay = z.infer<typeof NodeContractDisplaySchema>;

export const NodeOutputPortSchema = z
    .object({
        id: NodeOutputPortIdSchema,
        label: z.string().min(1),
    })
    .strict()
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
        strategy: z.string().min(1),
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
export type NodeOutputPortInput = z.input<typeof NodeOutputPortSchema>;
export type NodeOutputPortSpecInput = z.input<typeof NodeOutputPortSpecSchema>;

export const NodeContractSchema = z
    .object({
        identity: NodeIdentitySchema,
        version: z.literal(CURRENT_NODE_CONTRACT_VERSION),
        role: NodeRoleSchema,
        defaultConfig: z.unknown(),
        outputPorts: NodeOutputPortSpecSchema,
        display: NodeContractDisplaySchema,
    })
    .strict()
    .superRefine((contract, ctx) => {
        if (contract.outputPorts.kind !== 'fixed') return;

        const seen = new Set<string>();
        for (const [index, port] of contract.outputPorts.ports.entries()) {
            if (seen.has(port.id)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['outputPorts', 'ports', index, 'id'],
                    message: `Output port identity "${port.id}" is declared more than once.`,
                });
            }
            seen.add(port.id);
        }
    })
    .readonly();
export type NodeContractDefinition = z.input<typeof NodeContractSchema>;
export type ParsedNodeContract = z.output<typeof NodeContractSchema>;
export type NodeContract = ParsedNodeContract;

/**
 * The contract representation that may cross a worker or Electron Bridge.
 * Runtime config schemas and UI components are intentionally not part of this
 * value.
 */
const SerializableNodeContractSchemaImplementation = NodeContractSchema.superRefine(
    (contract, ctx) => {
        const parsedDefault = SerializableJsonValueSchema.safeParse(contract.defaultConfig);
        if (!parsedDefault.success) {
            const firstIssue = parsedDefault.error.issues[0];
            ctx.addIssue({
                code: 'custom',
                path: ['defaultConfig', ...(firstIssue?.path ?? [])],
                message:
                    firstIssue?.message ??
                    'Node Contract defaultConfig must contain JSON-serializable data only.',
            });
        }
    },
);

export type SerializableNodeContractInput = z.input<
    typeof SerializableNodeContractSchemaImplementation
>;
export type SerializableNodeContract = z.output<
    typeof SerializableNodeContractSchemaImplementation
>;

export const SerializableNodeContractSchema: z.ZodType<SerializableNodeContract, unknown> =
    z.preprocess((value, ctx) => {
        const complexity = checkSerializableJsonComplexity(value);
        if (!complexity.ok) {
            ctx.addIssue({
                code: 'custom',
                path: [...complexity.failure.path],
                message: complexityFailureMessage(
                    complexity.failure,
                    'Serializable Plugin Node Contract',
                ),
            });
            return undefined;
        }
        return value;
    }, SerializableNodeContractSchemaImplementation);
export const NodeContractSnapshotSchema = SerializableNodeContractSchema;
export type NodeContractSnapshot = SerializableNodeContract;
export const NodeContractSnapshotListSchema = z.array(NodeContractSnapshotSchema).readonly();

export type PluginNodeContractValidation =
    | { readonly ok: true; readonly contract: SerializableNodeContract }
    | { readonly ok: false; readonly error: string };

export function validatePluginNodeContract(
    unknown: unknown,
    pluginId: PluginId,
    nodeType: string,
): PluginNodeContractValidation {
    let parsed: ReturnType<typeof SerializableNodeContractSchema.safeParse>;
    try {
        parsed = SerializableNodeContractSchema.safeParse(unknown);
    } catch {
        return {
            ok: false,
            error: 'Serializable Plugin Node Contract could not be validated safely.',
        };
    }
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
        /** Optional domain code supplied by a strategy adapter. */
        diagnosticCode: z.string().min(1).optional(),
        /** Optional domain identity supplied by a strategy adapter. */
        caseId: z.string().min(1).optional(),
    })
    .strict()
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
        if (!registration) {
            return { status: 'unavailable', identity, reason: 'unregistered' };
        }
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
