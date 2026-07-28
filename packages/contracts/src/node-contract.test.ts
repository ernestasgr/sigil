import { describe, expect, it } from 'vitest';
import { NodeDiagnosticDetailsSchema } from './node-contract.js';

describe('NodeDiagnosticDetailsSchema', () => {
    it('accepts a namespaced diagnostic code with serializable data', () => {
        const result = NodeDiagnosticDetailsSchema.safeParse({
            namespace: 'plugin.example.router',
            code: 'invalid_config',
            data: {
                field: 'target',
                expected: ['event', 'payload'],
                received: null,
            },
        });

        expect(result.success).toBe(true);
    });

    it.each([
        { namespace: 'Plugin.Example', code: 'invalid_config' },
        { namespace: 'plugin.example', code: 'InvalidConfig' },
        { namespace: 'plugin.example', code: 'invalid.config' },
    ])('rejects a non-canonical diagnostic identity', (value) => {
        expect(NodeDiagnosticDetailsSchema.safeParse(value).success).toBe(false);
    });

    it('rejects non-serializable or cyclic diagnostic data', () => {
        expect(
            NodeDiagnosticDetailsSchema.safeParse({
                namespace: 'plugin.example',
                code: 'invalid_config',
                data: { value: Symbol('not-json') },
            }).success,
        ).toBe(false);

        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(
            NodeDiagnosticDetailsSchema.safeParse({
                namespace: 'plugin.example',
                code: 'invalid_config',
                data: cyclic,
            }).success,
        ).toBe(false);
    });

    it('rejects fields outside the versioned details envelope', () => {
        expect(
            NodeDiagnosticDetailsSchema.safeParse({
                namespace: 'plugin.example',
                code: 'invalid_config',
                caseId: 'switch-case',
            }).success,
        ).toBe(false);
    });
});
