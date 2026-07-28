import { PluginIdSchema } from '@sigil/contracts/ids';
import {
    checkSerializableJsonComplexity,
    SERIALIZABLE_NODE_CONTRACT_COMPLEXITY_LIMITS,
    validatePluginNodeContract,
} from '@sigil/contracts/node-contract';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    createNodeContractRegistry,
    fixedOutputPortSpec,
    type NodeContractInput,
    pluginNodeIdentity,
    reconstructNodeConfigurationSchema,
    registerSerializableNodeContract,
    resolveNodeContract,
} from './node-contract.js';
import { createBuiltinNodeContractRegistry } from './nodes/catalog.js';
import { switchOutputPortSpec, switchOutputPortStrategy } from './nodes/switch.js';

const pid = (id: string) => PluginIdSchema.parse(id);
const ANY_CONFIG_SCHEMA = {
    version: 1,
    dialect: 'https://json-schema.org/draft/2020-12/schema',
    schema: {},
} as const;

const STRING_CONFIG_SCHEMA = {
    version: 1,
    dialect: 'https://json-schema.org/draft/2020-12/schema',
    schema: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
        additionalProperties: false,
    },
} as const;

function serializablePluginContract(defaultConfig: unknown = {}) {
    return {
        identity: pluginNodeIdentity(pid('com.example.contract'), 'contract-node'),
        version: 1,
        role: 'action',
        configSchema: ANY_CONFIG_SCHEMA,
        defaultConfig,
        outputPorts: fixedOutputPortSpec(['out']),
        display: {
            label: 'Contract Node',
            description: 'A contract used by complexity-boundary tests.',
            category: 'utility',
        },
    } as const;
}

function nestedObject(depth: number): unknown {
    let value: unknown = 'leaf';
    for (let index = 0; index < depth; index += 1) {
        value = { child: value };
    }
    return value;
}

function valueCountTree(valueCount: number, collectionLimit: number): unknown[] {
    const children: unknown[] = [];
    let remaining = valueCount - 1;
    while (remaining > 0) {
        const leafCount = Math.min(collectionLimit, Math.max(0, remaining - 1));
        children.push(Array.from({ length: leafCount }, () => null));
        remaining -= leafCount + 1;
    }
    return children;
}

const switchNode = (config: unknown): NodeContractInput => ({
    type: 'switch',
    config,
});

describe('Node Contract Registry', () => {
    it('resolves built-in Switch ports with stable identities and display labels', () => {
        const registry = createBuiltinNodeContractRegistry();

        const result = resolveNodeContract(
            switchNode({
                target: 'payload',
                field: 'ext',
                comparison: 'string',
                cases: [
                    { id: 'pdf', value: 'pdf' },
                    { id: 'image', value: 'image' },
                ],
            }),
            registry,
        );

        expect(result).toEqual({
            status: 'available',
            identity: { namespace: 'builtin', type: 'switch' },
            contract: expect.objectContaining({
                role: 'action',
                outputPorts: expect.objectContaining({
                    kind: 'config-derived',
                    strategy: 'switch-cases',
                }),
            }),
            config: expect.any(Object),
            outputPorts: [
                { id: 'default', label: 'default' },
                { id: 'pdf', label: 'pdf' },
                { id: 'image', label: 'image' },
            ],
        });
    });

    it('exposes fixed built-in ports and deterministic registration ordering', () => {
        const registry = createBuiltinNodeContractRegistry();

        const result = resolveNodeContract(
            {
                type: 'if-else',
                config: {
                    condition: { target: 'event', operator: 'equals', value: 'file.created' },
                },
            },
            registry,
        );

        expect(result).toMatchObject({
            status: 'available',
            outputPorts: [
                { id: 'true', label: 'true' },
                { id: 'false', label: 'false' },
            ],
        });
        expect(registry.all().map((contract) => contract.identity)).toEqual([
            { namespace: 'builtin', type: 'file-watcher' },
            { namespace: 'builtin', type: 'manual-trigger' },
            { namespace: 'builtin', type: 'if-else' },
            { namespace: 'builtin', type: 'switch' },
            { namespace: 'builtin', type: 'file-manager' },
            { namespace: 'builtin', type: 'notification' },
            { namespace: 'builtin', type: 'log' },
            { namespace: 'builtin', type: 'delay' },
            { namespace: 'builtin', type: 'state-get' },
            { namespace: 'builtin', type: 'state-set' },
        ]);
    });

    it('returns an explicit invalid state for malformed built-in configuration', () => {
        const registry = createBuiltinNodeContractRegistry();

        const result = resolveNodeContract(
            switchNode({
                target: 'payload',
                field: 'ext',
                comparison: 'string',
                cases: [{ id: 'default', value: 'pdf' }],
            }),
            registry,
        );

        expect(result).toMatchObject({
            status: 'invalid',
            identity: { namespace: 'builtin', type: 'switch' },
            issues: [
                expect.objectContaining({
                    code: 'invalid_configuration',
                    path: 'cases[0].id',
                }),
            ],
        });
    });

    it('rejects invalid numeric Switch cases before output-port admission', () => {
        const registry = createBuiltinNodeContractRegistry();

        const result = resolveNodeContract(
            switchNode({
                target: 'payload',
                field: 'size',
                comparison: 'number',
                cases: [
                    { id: 'first', value: '1' },
                    { id: 'equivalent', value: '01.0' },
                    { id: 'invalid', value: 'large' },
                ],
            }),
            registry,
        );

        expect(result).toMatchObject({
            status: 'invalid',
            identity: { namespace: 'builtin', type: 'switch' },
            issues: expect.arrayContaining([
                expect.objectContaining({
                    details: expect.objectContaining({ code: 'duplicate_match_value' }),
                    path: 'cases[0].value',
                }),
                expect.objectContaining({
                    details: expect.objectContaining({ code: 'invalid_numeric_match_value' }),
                    path: 'cases[2].value',
                }),
            ]),
        });
    });

    it('keeps Plugin identity separate from built-in identity and reports missing contracts', () => {
        const registry = createBuiltinNodeContractRegistry();
        registerSerializableNodeContract(registry, {
            identity: pluginNodeIdentity(pid('com.example.log'), 'log'),
            version: 1,
            role: 'action',
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig: { message: 'plugin' },
            outputPorts: fixedOutputPortSpec(['out']),
            display: {
                label: 'Plugin Log',
                description: 'A plugin log node.',
                category: 'utility',
            },
        });

        const plugin = resolveNodeContract(
            {
                type: 'log',
                pluginId: pid('com.example.log'),
                config: { message: 'plugin' },
            },
            registry,
        );
        expect(plugin).toMatchObject({
            status: 'available',
            identity: pluginNodeIdentity(pid('com.example.log'), 'log'),
            outputPorts: [{ id: 'out', label: 'out' }],
        });

        const unavailable = resolveNodeContract(
            { type: 'log', pluginId: pid('com.example.missing'), config: { message: 'missing' } },
            registry,
        );
        expect(unavailable).toEqual({
            status: 'unavailable',
            identity: { namespace: 'plugin', pluginId: pid('com.example.missing'), type: 'log' },
            reason: 'unregistered',
        });
    });

    it('registers a serializable Plugin contract without importing runtime functions', () => {
        const validation = validatePluginNodeContract(
            {
                identity: pluginNodeIdentity(pid('com.example.file'), 'file-node'),
                version: 1,
                role: 'action',
                configSchema: ANY_CONFIG_SCHEMA,
                defaultConfig: { path: '/tmp' },
                outputPorts: fixedOutputPortSpec([{ id: 'out', label: 'Output' }]),
                display: { label: 'File Node', description: 'Moves a file.', category: 'system' },
            },
            pid('com.example.file'),
            'file-node',
        );

        expect(validation).toMatchObject({ ok: true });
        if (!validation.ok) return;

        const registry = createNodeContractRegistry([], {
            outputPortStrategies: { 'switch-cases': switchOutputPortStrategy },
        });
        registerSerializableNodeContract(registry, validation.contract);

        expect(
            resolveNodeContract(
                { type: 'file-node', pluginId: pid('com.example.file'), config: { path: '/tmp' } },
                registry,
            ),
        ).toMatchObject({
            status: 'available',
            outputPorts: [{ id: 'out', label: 'Output' }],
        });
    });

    it('reconstructs a host validator and rejects an invalid Plugin configuration', () => {
        const contract = {
            ...serializablePluginContract({ name: 'default' }),
            configSchema: STRING_CONFIG_SCHEMA,
            defaultConfig: { name: 'default' },
        };
        const registry = createNodeContractRegistry();
        registerSerializableNodeContract(registry, contract);

        expect(
            resolveNodeContract(
                {
                    type: 'contract-node',
                    pluginId: pid('com.example.contract'),
                    config: { name: 'Ada' },
                },
                registry,
            ),
        ).toMatchObject({ status: 'available', config: { name: 'Ada' } });

        expect(
            resolveNodeContract(
                {
                    type: 'contract-node',
                    pluginId: pid('com.example.contract'),
                    config: { name: 42 },
                },
                registry,
            ),
        ).toMatchObject({
            status: 'invalid',
            issues: [expect.objectContaining({ code: 'invalid_configuration', path: 'name' })],
        });
    });

    it('returns a typed reconstruction error for an unsupported JSON Schema feature', () => {
        expect(() =>
            reconstructNodeConfigurationSchema({
                version: 1,
                dialect: 'https://json-schema.org/draft/2020-12/schema',
                schema: {
                    type: 'object',
                    properties: { value: { not: { type: 'string' } } },
                },
            }),
        ).toThrow(/configuration schema could not be reconstructed/i);
    });

    it('returns a typed failure for an over-depth serializable Plugin contract', () => {
        expect(() =>
            validatePluginNodeContract(
                serializablePluginContract(nestedObject(64)),
                pid('com.example.contract'),
                'contract-node',
            ),
        ).not.toThrow();

        expect(
            validatePluginNodeContract(
                serializablePluginContract(nestedObject(64)),
                pid('com.example.contract'),
                'contract-node',
            ),
        ).toMatchObject({
            ok: false,
            error: expect.stringContaining('maximum depth'),
        });
    });

    it('returns a typed failure for a cyclic serializable Plugin contract', () => {
        const cyclicConfig: Record<string, unknown> = {};
        cyclicConfig.self = cyclicConfig;

        expect(() =>
            validatePluginNodeContract(
                serializablePluginContract(cyclicConfig),
                pid('com.example.contract'),
                'contract-node',
            ),
        ).not.toThrow();

        expect(
            validatePluginNodeContract(
                serializablePluginContract(cyclicConfig),
                pid('com.example.contract'),
                'contract-node',
            ),
        ).toMatchObject({
            ok: false,
            error: expect.stringContaining('cyclic'),
        });
    });

    it('admits values exactly at each documented complexity limit and rejects the next value', () => {
        const limits = SERIALIZABLE_NODE_CONTRACT_COMPLEXITY_LIMITS;

        expect(checkSerializableJsonComplexity(nestedObject(limits.maxDepth), limits)).toEqual({
            ok: true,
        });
        expect(
            checkSerializableJsonComplexity(nestedObject(limits.maxDepth + 1), limits),
        ).toMatchObject({ ok: false, failure: { kind: 'max-depth' } });

        expect(
            checkSerializableJsonComplexity(
                valueCountTree(limits.maxValueCount, limits.maxCollectionLength),
                limits,
            ),
        ).toEqual({ ok: true });
        expect(
            checkSerializableJsonComplexity(
                valueCountTree(limits.maxValueCount + 1, limits.maxCollectionLength),
                limits,
            ),
        ).toMatchObject({ ok: false, failure: { kind: 'max-value-count' } });

        expect(
            checkSerializableJsonComplexity(
                Array.from({ length: limits.maxCollectionLength }, () => null),
                limits,
            ),
        ).toEqual({ ok: true });
        expect(
            checkSerializableJsonComplexity(
                Array.from({ length: limits.maxCollectionLength + 1 }, () => null),
                limits,
            ),
        ).toMatchObject({ ok: false, failure: { kind: 'max-collection-length' } });

        expect(checkSerializableJsonComplexity('x'.repeat(limits.maxStringLength), limits)).toEqual(
            { ok: true },
        );
        expect(
            checkSerializableJsonComplexity('x'.repeat(limits.maxStringLength + 1), limits),
        ).toMatchObject({ ok: false, failure: { kind: 'max-string-length' } });
    });

    it('resolves and validates a Plugin config-derived contract through the Switch strategy', () => {
        const validation = validatePluginNodeContract(
            {
                identity: pluginNodeIdentity(pid('com.example.router'), 'router-node'),
                version: 1,
                role: 'action',
                configSchema: ANY_CONFIG_SCHEMA,
                defaultConfig: {
                    target: 'event',
                    cases: [{ id: 'ready', value: 'ready' }],
                },
                outputPorts: switchOutputPortSpec({ id: 'default', label: 'Fallback' }),
                display: {
                    label: 'Router Node',
                    description: 'Routes by event name.',
                    category: 'logic',
                },
            },
            pid('com.example.router'),
            'router-node',
        );

        expect(validation).toMatchObject({ ok: true });
        if (!validation.ok) return;

        const registry = createNodeContractRegistry([], {
            outputPortStrategies: { 'switch-cases': switchOutputPortStrategy },
        });
        registerSerializableNodeContract(registry, validation.contract);

        expect(
            resolveNodeContract(
                {
                    type: 'router-node',
                    pluginId: pid('com.example.router'),
                    config: {
                        target: 'event',
                        cases: [
                            { id: 'ready', value: 'ready' },
                            { id: 'failed', value: 'failed' },
                        ],
                    },
                },
                registry,
            ),
        ).toMatchObject({
            status: 'available',
            outputPorts: [
                { id: 'default', label: 'Fallback' },
                { id: 'ready', label: 'ready' },
                { id: 'failed', label: 'failed' },
            ],
        });

        const invalid = resolveNodeContract(
            {
                type: 'router-node',
                pluginId: pid('com.example.router'),
                config: {
                    target: 'event',
                    cases: [{ id: 'empty', value: '' }],
                },
            },
            registry,
        );

        expect(invalid).toMatchObject({
            status: 'invalid',
            issues: [
                expect.objectContaining({
                    code: 'invalid_configuration',
                    path: 'cases[0].value',
                }),
            ],
        });
    });

    it('keeps derived port identity and ordering deterministic across built-in and Plugin contracts', () => {
        const pluginRegistry = createNodeContractRegistry([], {
            outputPortStrategies: { 'switch-cases': switchOutputPortStrategy },
        });
        registerSerializableNodeContract(pluginRegistry, {
            identity: pluginNodeIdentity(pid('com.example.router'), 'router-node'),
            version: 1,
            role: 'action',
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig: { target: 'event', cases: [] },
            outputPorts: switchOutputPortSpec(),
            display: {
                label: 'Router Node',
                description: 'Routes by event name.',
                category: 'logic',
            },
        });

        const caseIds = fc.stringMatching(/^[a-z](?:[a-z0-9]|-[a-z0-9]){0,4}$/);
        const cases = fc
            .array(caseIds, { maxLength: 6 })
            .map((ids) =>
                [...new Set(ids)].filter((id) => id !== 'default').map((id) => ({ id, value: id })),
            );

        fc.assert(
            fc.property(cases, (derivedCases) => {
                const config = { target: 'event' as const, cases: derivedCases };
                const builtin = resolveNodeContract(
                    { type: 'switch', config },
                    createBuiltinNodeContractRegistry(),
                );
                const plugin = resolveNodeContract(
                    { type: 'router-node', pluginId: pid('com.example.router'), config },
                    pluginRegistry,
                );

                expect(builtin).toMatchObject({ status: 'available' });
                expect(plugin).toMatchObject({ status: 'available' });
                if (builtin.status !== 'available' || plugin.status !== 'available') return;

                expect(plugin.outputPorts).toEqual(builtin.outputPorts);
                expect(
                    resolveNodeContract(
                        { type: 'router-node', pluginId: pid('com.example.router'), config },
                        pluginRegistry,
                    ),
                ).toEqual(plugin);
            }),
            { numRuns: 100, verbose: true },
        );
    });

    it('distinguishes an explicitly dynamic contract from an unavailable contract', () => {
        const registry = createNodeContractRegistry();
        registerSerializableNodeContract(registry, {
            identity: pluginNodeIdentity(pid('com.example.dynamic'), 'dynamic-node'),
            version: 1,
            role: 'action',
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig: {},
            outputPorts: { kind: 'dynamic' },
            display: {
                label: 'Dynamic Node',
                description: 'Selects ports at runtime.',
                category: 'utility',
            },
        });

        expect(
            resolveNodeContract(
                { type: 'dynamic-node', pluginId: pid('com.example.dynamic'), config: {} },
                registry,
            ),
        ).toMatchObject({ status: 'available', outputPorts: 'dynamic' });
        expect(
            resolveNodeContract(
                { type: 'dynamic-node', pluginId: pid('com.example.missing'), config: {} },
                registry,
            ),
        ).toEqual({
            status: 'unavailable',
            identity: {
                namespace: 'plugin',
                pluginId: pid('com.example.missing'),
                type: 'dynamic-node',
            },
            reason: 'unregistered',
        });
    });

    it('rejects a Plugin contract whose identity or version is invalid', () => {
        expect(
            validatePluginNodeContract(
                {
                    identity: pluginNodeIdentity(pid('com.example.other'), 'file-node'),
                    version: 1,
                    role: 'action',
                    configSchema: ANY_CONFIG_SCHEMA,
                    defaultConfig: {},
                    outputPorts: fixedOutputPortSpec(['out']),
                    display: { label: 'File Node', description: '', category: 'system' },
                },
                pid('com.example.file'),
                'file-node',
            ),
        ).toMatchObject({ ok: false, error: expect.stringContaining('pluginId') });

        expect(
            validatePluginNodeContract(
                {
                    identity: pluginNodeIdentity(pid('com.example.file'), 'file-node'),
                    version: 2,
                    role: 'action',
                    configSchema: ANY_CONFIG_SCHEMA,
                    defaultConfig: {},
                    outputPorts: fixedOutputPortSpec(['out']),
                    display: { label: 'File Node', description: '', category: 'system' },
                },
                pid('com.example.file'),
                'file-node',
            ),
        ).toMatchObject({ ok: false });
    });

    it('requires config-derived strategies to be explicitly admitted by the registry', () => {
        const contract = {
            identity: pluginNodeIdentity(pid('com.example.custom'), 'custom-node'),
            version: 1 as const,
            role: 'action' as const,
            configSchema: ANY_CONFIG_SCHEMA,
            defaultConfig: {},
            outputPorts: {
                kind: 'config-derived' as const,
                strategy: 'custom-ports',
                defaultPort: { id: 'out', label: 'Output' },
            },
            display: {
                label: 'Custom Node',
                description: 'Uses an injected output-port strategy.',
                category: 'utility' as const,
            },
        };

        expect(() =>
            registerSerializableNodeContract(createNodeContractRegistry(), contract),
        ).toThrow(/No output-port strategy is registered/);

        const registry = createNodeContractRegistry([], {
            outputPortStrategies: {
                'custom-ports': () => ({ ok: true, value: 'dynamic' }),
            },
        });
        expect(() => registerSerializableNodeContract(registry, contract)).not.toThrow();
        expect(
            resolveNodeContract(
                { type: 'custom-node', pluginId: pid('com.example.custom'), config: {} },
                registry,
            ),
        ).toMatchObject({ status: 'available', outputPorts: 'dynamic' });
    });
});
