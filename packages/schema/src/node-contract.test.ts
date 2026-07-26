import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PluginIdSchema } from './ids.js';
import {
    createNodeContractRegistry,
    fixedOutputPortSpec,
    type NodeContractInput,
    pluginNodeIdentity,
    registerSerializableNodeContract,
    resolveNodeContract,
    validatePluginNodeContract,
} from './node-contract.js';
import { createBuiltinNodeContractRegistry } from './nodes/catalog.js';
import { switchOutputPortSpec, switchOutputPortStrategy } from './nodes/switch.js';

const pid = (id: string) => PluginIdSchema.parse(id);

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

    it('keeps Plugin identity separate from built-in identity and reports missing contracts', () => {
        const registry = createBuiltinNodeContractRegistry();
        registerSerializableNodeContract(registry, {
            identity: pluginNodeIdentity(pid('com.example.log'), 'log'),
            version: 1,
            role: 'action',
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

    it('resolves and validates a Plugin config-derived contract through the Switch strategy', () => {
        const validation = validatePluginNodeContract(
            {
                identity: pluginNodeIdentity(pid('com.example.router'), 'router-node'),
                version: 1,
                role: 'action',
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
            defaultConfig: { target: 'event', cases: [] },
            outputPorts: switchOutputPortSpec(),
            display: {
                label: 'Router Node',
                description: 'Routes by event name.',
                category: 'logic',
            },
        });

        const caseIds = fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/);
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
