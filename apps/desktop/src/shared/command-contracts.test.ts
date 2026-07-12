import { describe, expect, it } from 'vitest';

import {
    CommandContracts,
    CommandFailureSchema,
    EngineCommandContracts,
    EngineToMainMessageSchema,
    MainToEngineMessageSchema,
    RendererCommandContracts,
} from './command-contracts.js';
import { CorrelationIdSchema, EngineChannel } from './ipc-channels.js';

const expectedCommandNames = [
    'rendererReady',
    'pingEngine',
    'fireTestEvent',
    'toggleWorkflow',
    'retryWorkflow',
    'createWorkflow',
    'updateWorkflow',
    'deleteWorkflow',
    'getWorkflow',
    'listPlugins',
    'setPermissionOverride',
    'readProperties',
    'saveProperties',
    'openFileDialog',
    'fireManualTrigger',
    'readWorkflowState',
    'setWorkflowStateKey',
    'deleteWorkflowStateKey',
    'shutdown',
] as const;

describe('CommandContracts', () => {
    it('enumerates every current command with an explicit request and response schema', () => {
        expect(Object.keys(CommandContracts)).toEqual(expectedCommandNames);

        for (const commandName of expectedCommandNames) {
            const contract = CommandContracts[commandName];
            expect('renderer' in contract || 'engine' in contract).toBe(true);

            if ('renderer' in contract) {
                expect(contract.renderer.requestSchema).toBeDefined();
                expect(contract.renderer.responseSchema).toBeDefined();
            }
            if ('engine' in contract) {
                expect(contract.engine.requestSchema).toBeDefined();
                expect(contract.engine.responseSchema).toBeDefined();
                expect(contract.engine.failureSchema).toBeDefined();
            }
        }
    });

    it('accepts only the message direction allowed at the engine seam', () => {
        const request = {
            type: EngineChannel.ToggleWorkflow,
            correlationId: 'corr-1',
            id: 'wf-1',
        };
        const response = {
            type: EngineChannel.ToggleWorkflowResult,
            correlationId: 'corr-1',
            summary: null,
        };

        expect(MainToEngineMessageSchema.safeParse(request).success).toBe(true);
        expect(MainToEngineMessageSchema.safeParse(response).success).toBe(false);
        expect(EngineToMainMessageSchema.safeParse(response).success).toBe(true);
        expect(EngineToMainMessageSchema.safeParse(request).success).toBe(false);
    });

    it('gives every engine command one correlation policy and an explicit transport failure', () => {
        for (const contract of Object.values(EngineCommandContracts)) {
            expect(contract.correlation).toBe('correlationId');
            expect(
                contract.failureSchema.safeParse({
                    ok: false,
                    code: 'timeout',
                    error: 'command timed out',
                }).success,
            ).toBe(true);
        }

        expect(CorrelationIdSchema.safeParse('').success).toBe(false);
        expect(CommandFailureSchema.safeParse({ ok: true }).success).toBe(false);
    });

    it('keeps expected renderer failures in the response contract', () => {
        const failure = { ok: false, error: 'Engine not ready' };

        expect(
            RendererCommandContracts.fireTestEvent.responseSchema.safeParse(failure).success,
        ).toBe(true);
        expect(
            RendererCommandContracts.fireManualTrigger.responseSchema.safeParse(failure).success,
        ).toBe(true);
        expect(
            RendererCommandContracts.toggleWorkflow.responseSchema.safeParse({
                ok: false,
                error: 'Could not toggle Workflow.',
                diagnostics: [],
            }).success,
        ).toBe(true);
    });
});
