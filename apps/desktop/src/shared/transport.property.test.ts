import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    NodePluginDepsRpcSchema,
    NodePluginWorkerKind,
    NodePluginWorkerToMainSchema,
} from '../engine/plugin-node-rpc.js';
import {
    EngineChannel,
    EngineToMainMessageSchema,
    MainToEngineMessageSchema,
} from './ipc-channels.js';
import { PersistenceWriteOutcomeSchema } from './persistence.js';

const PROPERTY_OPTIONS = {
    numRuns: 100,
    verbose: true,
};

const correlationIdArbitrary = fc.string({ minLength: 1, maxLength: 16 });
const workflowIdArbitrary = fc.constantFrom('wf-a', 'wf-b', 'wf-c');

const pipeline = {
    id: 'pipeline-transport',
    workflowId: 'wf-a',
    schemaVersion: 1,
    nodes: [],
    edges: [],
} as const;

const summary = {
    id: 'wf-a',
    name: 'Generated Workflow',
    enabled: true,
    activation: { kind: 'active' },
} as const;

const requestArbitrary = fc.oneof(
    fc.record({
        type: fc.constant(EngineChannel.Ping),
        correlationId: correlationIdArbitrary,
    }),
    fc.record({
        type: fc.constant(EngineChannel.ToggleWorkflow),
        correlationId: correlationIdArbitrary,
        id: workflowIdArbitrary,
    }),
    fc.record({
        type: fc.constant(EngineChannel.CreateWorkflow),
        correlationId: correlationIdArbitrary,
        name: fc.constantFrom('', 'Generated Workflow'),
        pipeline: fc.constant(pipeline),
        positions: fc.constant({}),
    }),
    fc.record({
        type: fc.constant(EngineChannel.SetWorkflowStateKey),
        correlationId: correlationIdArbitrary,
        workflowId: workflowIdArbitrary,
        key: fc.constantFrom('alpha', 'beta', ''),
        value: fc.string({ minLength: 0, maxLength: 12 }),
    }),
    fc.record({
        type: fc.constant(EngineChannel.Shutdown),
        correlationId: correlationIdArbitrary,
    }),
);

const responseArbitrary = fc.oneof(
    fc.record({
        type: fc.constant(EngineChannel.Pong),
        correlationId: correlationIdArbitrary,
        receivedAt: fc.integer({ min: 0, max: 100_000 }),
    }),
    fc.record({
        type: fc.constant(EngineChannel.ToggleWorkflowResult),
        correlationId: correlationIdArbitrary,
        summary: fc.constant(summary),
    }),
    fc.record({
        type: fc.constant(EngineChannel.GetWorkflowResult),
        correlationId: correlationIdArbitrary,
        found: fc.constant(true),
        name: fc.constant('Generated Workflow'),
        pipeline: fc.constant(pipeline),
        positions: fc.constant({}),
    }),
    fc.record({
        type: fc.constant(EngineChannel.ReadWorkflowStateResult),
        correlationId: correlationIdArbitrary,
        entries: fc.array(
            fc.record({
                key: fc.constantFrom('alpha', 'beta'),
                value: fc.string({ minLength: 0, maxLength: 12 }),
            }),
            { maxLength: 4 },
        ),
    }),
    fc.record({
        type: fc.constant(EngineChannel.SavePropertiesResult),
        correlationId: correlationIdArbitrary,
        ok: fc.constant(false),
        error: fc.constant('generated replacement failure'),
        diagnostic: fc.constant({
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: 'C:/sigil.properties.json',
            message: 'replacement interrupted',
        }),
    }),
);

const pluginEnvelopeArbitrary = fc.constantFrom(
    {
        kind: NodePluginWorkerKind.ExecuteResult,
        requestId: 'request-1',
        outputCtx: { event: '', payload: {}, vars: {} },
        activePort: 'out',
    },
    {
        kind: NodePluginWorkerKind.DepsRpc,
        requestId: 'request-1',
        operation: 'state.get',
        args: ['alpha'],
    },
    {
        kind: NodePluginWorkerKind.DepsRpc,
        requestId: 'request-1',
        operation: 'event.emit',
        args: ['generated.event', {}],
    },
);

const persistenceDiagnosticArbitrary = fc.record({
    kind: fc.constant('persistence'),
    operation: fc.constantFrom('read', 'write'),
    phase: fc.constantFrom(
        'directory',
        'open',
        'serialize',
        'write',
        'flush',
        'directory_flush',
        'close',
        'replace',
        'parse',
    ),
    path: fc.constantFrom('C:/sigil.properties.json', 'C:/workflows/wf-a.json'),
    message: fc.string({ minLength: 1, maxLength: 20 }),
});

const persistenceOutcomeArbitrary = fc.oneof(
    fc.constant({ ok: true as const }),
    fc.record({
        ok: fc.constant(false),
        error: fc.string({ minLength: 1, maxLength: 20 }),
        diagnostic: persistenceDiagnosticArbitrary,
    }),
);

describe('generated IPC transport properties', () => {
    it('accepts JSON round trips for generated Main-to-Engine envelopes', () => {
        fc.assert(
            fc.property(requestArbitrary, (message) => {
                const parsed = MainToEngineMessageSchema.safeParse(
                    JSON.parse(JSON.stringify(message)),
                );

                expect(parsed.success).toBe(true);
                if (parsed.success) expect(parsed.data).toEqual(message);
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('accepts JSON round trips for generated Engine-to-Main envelopes', () => {
        fc.assert(
            fc.property(responseArbitrary, (message) => {
                const parsed = EngineToMainMessageSchema.safeParse(
                    JSON.parse(JSON.stringify(message)),
                );

                expect(parsed.success).toBe(true);
                if (parsed.success) expect(parsed.data).toEqual(message);
            }),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated malformed Main-to-Engine envelopes at the receive schema', () => {
        fc.assert(
            fc.property(
                requestArbitrary,
                fc.constantFrom('unknown-type', 'missing-correlation', 'invalid-correlation'),
                (message, malformedKind) => {
                    const malformed =
                        malformedKind === 'unknown-type'
                            ? { ...message, type: 'engine:unknown' }
                            : malformedKind === 'missing-correlation'
                              ? { ...message, correlationId: undefined }
                              : { ...message, correlationId: 0 };

                    expect(MainToEngineMessageSchema.safeParse(malformed).success).toBe(false);
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('rejects generated malformed Engine-to-Main envelopes at the receive schema', () => {
        fc.assert(
            fc.property(
                responseArbitrary,
                fc.constantFrom('unknown-type', 'missing-correlation', 'invalid-correlation'),
                (message, malformedKind) => {
                    const malformed =
                        malformedKind === 'unknown-type'
                            ? { ...message, type: 'engine:unknown' }
                            : malformedKind === 'missing-correlation'
                              ? { ...message, correlationId: undefined }
                              : { ...message, correlationId: 0 };

                    expect(EngineToMainMessageSchema.safeParse(malformed).success).toBe(false);
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('preserves valid Node Plugin envelopes and rejects malformed worker messages', () => {
        fc.assert(
            fc.property(
                pluginEnvelopeArbitrary,
                fc.constantFrom('unknown-kind', 'invalid-request-id'),
                (message, malformedKind) => {
                    expect(NodePluginWorkerToMainSchema.safeParse(message).success).toBe(true);

                    const malformed =
                        malformedKind === 'unknown-kind'
                            ? { ...message, kind: 'npw:unknown' }
                            : { ...message, requestId: 42 };
                    expect(NodePluginWorkerToMainSchema.safeParse(malformed).success).toBe(false);
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('keeps generated persistence outcomes round-trippable and rejects malformed envelopes', () => {
        fc.assert(
            fc.property(
                persistenceOutcomeArbitrary,
                fc.constantFrom('invalid-ok', 'invalid-diagnostic', 'invalid-phase'),
                (outcome, malformedKind) => {
                    const roundTrip = PersistenceWriteOutcomeSchema.safeParse(
                        JSON.parse(JSON.stringify(outcome)),
                    );
                    expect(roundTrip.success).toBe(true);
                    if (roundTrip.success) expect(roundTrip.data).toEqual(outcome);

                    const malformed =
                        malformedKind === 'invalid-ok'
                            ? { ...outcome, ok: 'maybe' }
                            : {
                                  ok: false,
                                  error: 'malformed generated envelope',
                                  diagnostic:
                                      malformedKind === 'invalid-phase'
                                          ? {
                                                kind: 'persistence',
                                                operation: 'write',
                                                phase: 'unknown',
                                                path: 'C:/sigil.json',
                                                message: 'invalid phase',
                                            }
                                          : { invalid: true },
                              };
                    expect(PersistenceWriteOutcomeSchema.safeParse(malformed).success).toBe(false);
                },
            ),
            PROPERTY_OPTIONS,
        );
    });

    it('keeps the focused RPC schema regression examples beside generated envelopes', () => {
        expect(
            NodePluginDepsRpcSchema.safeParse({
                kind: NodePluginWorkerKind.DepsRpc,
                requestId: 'request-regression',
                operation: 'state.get',
                args: ['alpha'],
            }).success,
        ).toBe(true);
        expect(
            NodePluginDepsRpcSchema.safeParse({
                kind: NodePluginWorkerKind.DepsRpc,
                requestId: 'request-regression',
                operation: 'state.get',
                args: [42],
            }).success,
        ).toBe(false);
        expect(
            NodePluginWorkerToMainSchema.safeParse({
                kind: NodePluginWorkerKind.ExecuteResult,
                requestId: 'request-regression',
                outputCtx: { event: '', payload: {}, vars: {} },
                activePort: 'out',
            }).success,
        ).toBe(true);
    });
});
