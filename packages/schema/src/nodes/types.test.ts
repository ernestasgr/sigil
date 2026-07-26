import { describe, expect, it } from 'vitest';

import { DelayDescriptor } from './delay.js';
import { type BuiltinNodeContractDefinition, defineNodeRegistration } from './types.js';

const logContract: BuiltinNodeContractDefinition<'log'> = {
    identity: { namespace: 'builtin', type: 'log' },
    version: 1,
    role: 'action',
    outputPorts: { kind: 'fixed', ports: [{ id: 'out', label: 'Output' }] },
    display: { label: 'Log', description: 'Writes a log entry.', category: 'utility' },
};

describe('node registration typing', () => {
    it('rejects a log contract paired with a delay descriptor', () => {
        // @ts-expect-error A descriptor and its contract must have the same node identity.
        const registration = defineNodeRegistration(DelayDescriptor, logContract);

        expect(registration.contract.identity).toEqual(logContract.identity);
    });
});
