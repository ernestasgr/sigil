import { DelayConfigSchema } from '@sigil/contracts/workflow';
import { describe, expect, it } from 'vitest';
import { type BuiltinNodeContractDefinition, defineNodeRegistration } from './types.js';

const logContract: BuiltinNodeContractDefinition<'log'> = {
    identity: { namespace: 'builtin', type: 'log' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: { label: 'Log', description: 'Writes a log entry.', category: 'utility' },
};

const delayDescriptor = {
    type: 'delay' as const,
    configSchema: DelayConfigSchema,
    defaultConfig: { ms: 1000 },
};

describe('node registration typing', () => {
    it('rejects a log contract paired with a delay descriptor', () => {
        // @ts-expect-error A descriptor and its contract must have the same node identity.
        const registration = defineNodeRegistration(delayDescriptor, logContract);

        expect(registration.contract.identity).toEqual(logContract.identity);
    });
});
