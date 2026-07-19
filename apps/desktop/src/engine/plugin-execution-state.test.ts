import { describe, expect, it } from 'vitest';

import { createPluginExecutionState, transitionPluginExecution } from './plugin-execution-state.js';

describe('Plugin execution cancellation state machine', () => {
    it('requires cancellation acknowledgement before a cancelled execution settles', () => {
        const requested = transitionPluginExecution(createPluginExecutionState(), {
            kind: 'cancel-requested',
            reason: 'execution timed out',
        });

        expect(requested).toEqual({
            accepted: true,
            state: { kind: 'cancellation-requested', reason: 'execution timed out' },
        });

        const lateResult = transitionPluginExecution(requested.state, { kind: 'completed' });
        expect(lateResult).toEqual({ accepted: false, state: requested.state });

        const acknowledged = transitionPluginExecution(requested.state, {
            kind: 'cancel-acknowledged',
        });
        expect(acknowledged).toEqual({ accepted: true, state: { kind: 'settled' } });
    });

    it('ignores every late transition after an execution has settled', () => {
        const settled = transitionPluginExecution(createPluginExecutionState(), {
            kind: 'completed',
        });

        expect(settled).toEqual({ accepted: true, state: { kind: 'settled' } });
        expect(
            transitionPluginExecution(settled.state, {
                kind: 'cancel-requested',
                reason: 'late timeout',
            }),
        ).toEqual({ accepted: false, state: settled.state });
    });
});
