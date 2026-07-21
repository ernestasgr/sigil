import { describe, expect, it } from 'vitest';

import {
    adaptNodeDescriptor,
    createBuiltinNodeContractRegistry,
    type NodeContractInput,
    pluginNodeIdentity,
    resolveNodeContract,
} from './node-contract.js';
import { LogDescriptor } from './nodes/log.js';

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
            { namespace: 'builtin', type: 'state-get' },
            { namespace: 'builtin', type: 'state-set' },
            { namespace: 'builtin', type: 'log' },
            { namespace: 'builtin', type: 'delay' },
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
        registry.register(
            adaptNodeDescriptor(LogDescriptor, {
                namespace: 'plugin',
                pluginId: 'com.example.log',
            }),
        );

        const plugin = resolveNodeContract(
            {
                type: 'log',
                pluginId: 'com.example.log',
                config: { message: 'plugin' },
            },
            registry,
        );
        expect(plugin).toMatchObject({
            status: 'available',
            identity: pluginNodeIdentity('com.example.log', 'log'),
            outputPorts: [{ id: 'out', label: 'out' }],
        });

        const unavailable = resolveNodeContract(
            { type: 'log', pluginId: 'com.example.missing', config: { message: 'missing' } },
            registry,
        );
        expect(unavailable).toEqual({
            status: 'unavailable',
            identity: { namespace: 'plugin', pluginId: 'com.example.missing', type: 'log' },
            reason: 'unregistered',
        });
    });
});
