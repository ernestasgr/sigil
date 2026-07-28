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

/** The current version of the serializable Node Contract wire format. */
export const CURRENT_NODE_CONTRACT_VERSION = 1 as const;

/** The current version of the serializable Plugin Node configuration schema envelope. */
export const CURRENT_NODE_CONFIGURATION_SCHEMA_VERSION = 1 as const;

/** The only JSON Schema dialect accepted at the Plugin boundary. */
export const SUPPORTED_NODE_CONFIGURATION_SCHEMA_DIALECT =
    'https://json-schema.org/draft/2020-12/schema' as const;

export type SerializableJsonValue =
    | string
    | number
    | boolean
    | null
    | SerializableJsonValue[]
    | { readonly [key: string]: SerializableJsonValue };

/**
 * Bounds applied before recursive validation of untrusted serializable
 * contract data. Values are measured in UTF-16 code units and aggregate
 * values, not only object nodes, count toward the budget.
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

function assertNever(value: never): never {
    throw new Error(`Unhandled Node Contract case: ${JSON.stringify(value)}`);
}

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

/** Iteratively inspects an input before any recursive Zod traversal. */
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
            if (key === undefined) continue;
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

export type SerializableJsonSchema = boolean | { readonly [key: string]: unknown };

export const SerializableJsonSchemaSchema: z.ZodType<SerializableJsonSchema, unknown> =
    z.custom<SerializableJsonSchema>(
        (value): value is SerializableJsonSchema => {
            if (typeof value === 'boolean') return true;
            if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

            try {
                return SerializableJsonValueSchema.safeParse(value).success;
            } catch {
                return false;
            }
        },
        { message: 'JSON Schema must be a JSON object or boolean.' },
    );

export const NodeConfigurationSchemaVersionSchema = z.literal(
    CURRENT_NODE_CONFIGURATION_SCHEMA_VERSION,
);
export type NodeConfigurationSchemaVersion = z.infer<typeof NodeConfigurationSchemaVersionSchema>;

export const NodeConfigurationSchemaDialectSchema = z.literal(
    SUPPORTED_NODE_CONFIGURATION_SCHEMA_DIALECT,
);
export type NodeConfigurationSchemaDialect = z.infer<typeof NodeConfigurationSchemaDialectSchema>;

const SerializableNodeConfigurationSchemaImplementation = z
    .object({
        version: NodeConfigurationSchemaVersionSchema,
        dialect: NodeConfigurationSchemaDialectSchema,
        schema: SerializableJsonSchemaSchema,
    })
    .strict()
    .superRefine((configurationSchema, ctx) => {
        if (typeof configurationSchema.schema === 'boolean') return;

        const declaredDialect = configurationSchema.schema.$schema;
        if (declaredDialect !== undefined && declaredDialect !== configurationSchema.dialect) {
            ctx.addIssue({
                code: 'custom',
                path: ['schema', '$schema'],
                message:
                    `JSON Schema declares dialect "${String(declaredDialect)}", but the ` +
                    `configuration schema envelope declares "${configurationSchema.dialect}".`,
            });
        }
    })
    .readonly();

export type SerializableNodeConfigurationSchemaInput = z.input<
    typeof SerializableNodeConfigurationSchemaImplementation
>;
export type SerializableNodeConfigurationSchema = z.output<
    typeof SerializableNodeConfigurationSchemaImplementation
>;

export const SerializableNodeConfigurationSchema: z.ZodType<
    SerializableNodeConfigurationSchema,
    unknown
> = SerializableNodeConfigurationSchemaImplementation;

/** Add the explicit dialect marker required by the host/worker comparison. */
export function normalizeNodeConfigurationSchema(
    value: unknown,
): SerializableNodeConfigurationSchema {
    const parsed = SerializableNodeConfigurationSchema.parse(value);
    if (typeof parsed.schema === 'boolean' || parsed.schema.$schema !== undefined) {
        return parsed;
    }

    return SerializableNodeConfigurationSchema.parse({
        ...parsed,
        schema: {
            ...parsed.schema,
            $schema: parsed.dialect,
        },
    });
}

/** Convert a runtime Zod schema into the versioned Plugin wire representation. */
export function serializeNodeConfigurationSchema(
    schema: z.ZodType,
): SerializableNodeConfigurationSchema {
    let jsonSchema: unknown;
    try {
        jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    } catch (error) {
        throw new Error(
            `Plugin Node configuration schema could not be serialized: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    return normalizeNodeConfigurationSchema({
        version: CURRENT_NODE_CONFIGURATION_SCHEMA_VERSION,
        dialect: SUPPORTED_NODE_CONFIGURATION_SCHEMA_DIALECT,
        schema: jsonSchema,
    });
}

const BuiltinNodeIdentitySchema = z
    .object({ namespace: z.literal('builtin'), type: NodeTypeNameSchema })
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
    .object({ id: NodeOutputPortIdSchema, label: z.string().min(1) })
    .strict()
    .readonly();
export type NodeOutputPort = z.infer<typeof NodeOutputPortSchema>;

const FixedOutputPortSpecSchema = z
    .object({ kind: z.literal('fixed'), ports: z.array(NodeOutputPortSchema).min(1) })
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
    .object({ kind: z.literal('dynamic') })
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
        configSchema: SerializableNodeConfigurationSchema,
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
    value: unknown,
    pluginId: PluginId,
    nodeType: string,
): PluginNodeContractValidation {
    let parsed: ReturnType<typeof SerializableNodeContractSchema.safeParse>;
    try {
        parsed = SerializableNodeContractSchema.safeParse(value);
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
        diagnosticCode: z.string().min(1).optional(),
        caseId: z.string().min(1).optional(),
    })
    .strict()
    .readonly();
export type NodeContractIssue = z.infer<typeof NodeContractIssueSchema>;

export type { NodeOutputPortId };
