import { PluginIdSchema } from '@sigil/contracts/ids';
import { describe, expect, it } from 'vitest';

import {
    CommandFailureSchema,
    EngineCommandContracts,
    type EngineCommandName,
    EngineToMainMessageSchema,
    MainToEngineMessageSchema,
} from './command-contracts.js';
import { CorrelationIdSchema, EngineChannel } from './ipc-channels.js';

const expectedEngineCommandNames = [
    'ping',
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
    'fireManualTrigger',
    'readWorkflowState',
    'setWorkflowStateKey',
    'deleteWorkflowStateKey',
    'shutdown',
] as const satisfies readonly EngineCommandName[];

const document = {
    id: 'pipeline-1',
    workflowId: 'wf-1',
    schemaVersion: 1,
    nodes: [],
    edges: [],
} as const;

const summary = {
    id: 'wf-1',
    name: 'Workflow',
    enabled: true,
    activation: { kind: 'active' },
} as const;

const FIXTURE_PLUGIN_ID = PluginIdSchema.parse('com.example.plugin-1');

const engineFixtures = {
    ping: { request: {}, response: { receivedAt: 1 } },
    fireTestEvent: { request: {}, response: { ok: true } },
    toggleWorkflow: { request: { id: 'wf-1' }, response: { summary } },
    retryWorkflow: { request: { id: 'wf-1' }, response: { summary } },
    createWorkflow: {
        request: { name: 'Workflow', document, positions: {} },
        response: { summary },
    },
    updateWorkflow: {
        request: { id: 'wf-1', name: 'Workflow', document, positions: {} },
        response: { summary },
    },
    deleteWorkflow: { request: { id: 'wf-1' }, response: { success: true } },
    getWorkflow: { request: { id: 'wf-1' }, response: { found: false, error: 'Not found' } },
    listPlugins: {
        request: {},
        response: {
            plugins: [
                {
                    manifest: {
                        id: FIXTURE_PLUGIN_ID,
                        version: '1.0.0',
                        permissions: [],
                        emits: ['plugin.event'],
                        nodeType: 'fixture-node',
                        nodeContract: {
                            identity: {
                                namespace: 'plugin',
                                pluginId: FIXTURE_PLUGIN_ID,
                                type: 'fixture-node',
                            },
                            version: 1,
                            role: 'action',
                            defaultConfig: {},
                            outputPorts: {
                                kind: 'fixed',
                                ports: [{ id: 'out', label: 'Output' }],
                            },
                            display: {
                                label: 'Fixture Node',
                                description: 'A transport fixture.',
                                category: 'utility',
                            },
                        },
                    },
                    grantedPermissions: [],
                },
            ],
        },
    },
    setPermissionOverride: {
        request: { pluginId: FIXTURE_PLUGIN_ID, overrides: [] },
        response: { ok: true, grantedPermissions: [], cancelledRunIds: [] },
    },
    readProperties: { request: {}, response: { properties: {} } },
    saveProperties: {
        request: { properties: {} },
        response: { ok: true, applied: {}, restartRequired: [] },
    },
    fireManualTrigger: { request: { document }, response: { ok: true } },
    readWorkflowState: { request: { workflowId: 'wf-1' }, response: { entries: [] } },
    setWorkflowStateKey: {
        request: { workflowId: 'wf-1', key: 'key', value: 'value' },
        response: { ok: true },
    },
    deleteWorkflowStateKey: {
        request: { workflowId: 'wf-1', key: 'key' },
        response: { ok: true },
    },
    shutdown: { request: {}, response: { ok: true } },
} satisfies {
    readonly [C in EngineCommandName]: {
        readonly request: Readonly<Record<string, unknown>>;
        readonly response: Readonly<Record<string, unknown>>;
    };
};

describe('EngineCommandContracts', () => {
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

    it('accepts a valid request and response fixture for every Engine command', () => {
        for (const commandName of expectedEngineCommandNames) {
            const contract = EngineCommandContracts[commandName];
            const fixture = engineFixtures[commandName];
            const correlationId = `corr-${commandName}`;

            const request = {
                ...fixture.request,
                type: contract.command,
                correlationId,
            };
            const response = {
                ...fixture.response,
                type: contract.responseType,
                correlationId,
            };

            expect(contract.requestSchema.safeParse(request).success).toBe(true);
            expect(contract.responseSchema.safeParse(response).success).toBe(true);
            expect(MainToEngineMessageSchema.safeParse(request).success).toBe(true);
            expect(EngineToMainMessageSchema.safeParse(response).success).toBe(true);
        }
    });
});
