import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createEngineDiagnostic,
    EngineDiagnosticPayloadSchema,
} from '../shared/event-payload-schemas.js';

import {
    type EngineBusEvent,
    EngineChannel,
    type EngineGetWorkflowResult,
    type EngineLog,
    type EnginePong,
    type EngineToggleWorkflowResult,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';

import {
    createRpcClient,
    type RpcClientProps,
    toPermissionOverrideOutcome,
    workerDiagnosticEvent,
} from './engine-client.js';

function buildProps(): { props: RpcClientProps; sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        sent,
        props: {
            postMessage: (msg) => {
                sent.push(msg);
            },
            logHandlers: new Set(),
            workflowsListHandlers: new Set(),
            busEventHandlers: new Set(),
        },
    };
}

describe('worker failure diagnostics', () => {
    it('keeps the engine and main worker diagnostic payloads schema-valid and equivalent', () => {
        const message = '[worker] engine worker error: native binding failed';
        const engineEvent = createEngineDiagnostic({
            message,
            kind: 'engine-worker',
            source: 'worker',
            outcome: 'failed',
        });
        const mainEvent = workerDiagnosticEvent(message);

        expect(EngineDiagnosticPayloadSchema.safeParse(engineEvent.payload).success).toBe(true);
        expect(EngineDiagnosticPayloadSchema.safeParse(mainEvent.payload).success).toBe(true);
        expect(mainEvent).toMatchObject({
            name: 'engine.diagnostic',
            payload: engineEvent.payload,
            telemetry: {
                kind: 'diagnostic',
                severity: 'error',
                summary: message,
            },
        });
    });
});

describe('rpc', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends a message via postMessage with correlationId and type added', () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        client.request('toggleWorkflow', { id: 'wf-1' }, 5000);

        expect(sent).toHaveLength(1);
        const msg = sent[0] as Record<string, unknown>;
        expect(msg).toMatchObject({
            type: 'engine:toggle-workflow',
            id: 'wf-1',
        });
        expect(msg).toHaveProperty('correlationId');
        expect(typeof msg.correlationId).toBe('string');
    });

    it('resolves the promise when a matching response with correlationId is dispatched', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('toggleWorkflow', { id: 'wf-1' }, 5000);

        const correlationId = (sent[0] as Record<string, string>).correlationId;

        const response: EngineToggleWorkflowResult = {
            type: 'engine:toggle-workflow-result',
            correlationId,
            summary: {
                id: 'wf-1',
                name: 'My Workflow',
                enabled: true,
                activation: { kind: 'active' },
            },
        };
        client.dispatch(response);

        const result = await promise;
        expect(result.summary).toEqual({
            id: 'wf-1',
            name: 'My Workflow',
            enabled: true,
            activation: { kind: 'active' },
        });
    });

    it('ignores a duplicate response after the pending call has settled', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);
        const settled = vi.fn();

        const promise = client.request('ping', {}, 5000);
        const correlationId = (sent[0] as Record<string, string>).correlationId;
        const pong: EnginePong = {
            correlationId,
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        const observed = promise.then(settled);

        client.dispatch(pong);
        await observed;
        client.dispatch(pong);
        await Promise.resolve();

        expect(settled).toHaveBeenCalledTimes(1);
    });

    it('ignores non-matching messages (different correlationId)', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('toggleWorkflow', { id: 'wf-1' }, 5000);

        const nonMatching: EngineGetWorkflowResult = {
            type: EngineChannel.GetWorkflowResult,
            correlationId: 'some-other-id',
            found: false,
            error: 'Not found',
        };
        client.dispatch(nonMatching);

        const raced = await Promise.race([
            promise.then(() => 'resolved'),
            Promise.resolve('still-pending'),
        ]);
        expect(raced).toBe('still-pending');
    });

    it('does not resolve a pending command when the response discriminator is wrong', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('toggleWorkflow', { id: 'wf-1' }, 5000);
        const correlationId = (sent[0] as Record<string, string>).correlationId;
        const wrongResponse: EngineGetWorkflowResult = {
            type: EngineChannel.GetWorkflowResult,
            correlationId,
            found: false,
            error: 'Not found',
        };
        client.dispatch(wrongResponse);

        const raced = await Promise.race([
            promise.then(() => 'resolved'),
            Promise.resolve('still-pending'),
        ]);
        expect(raced).toBe('still-pending');
    });

    it('rejects the promise on timeout', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('ping', {}, 1000);

        vi.advanceTimersByTime(1000);

        await expect(promise).rejects.toThrow('timed out');
    });

    it('cleans up the pending entry on timeout', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('ping', {}, 1000);
        vi.advanceTimersByTime(1000);
        await expect(promise).rejects.toThrow();

        const id = (sent[0] as Record<string, string>).correlationId;
        const lateResponse: EnginePong = {
            correlationId: id,
            type: 'engine:pong',
            receivedAt: Date.now(),
        };
        expect(() => client.dispatch(lateResponse)).not.toThrow();
    });
});

describe('permission override outcome mapping', () => {
    it('preserves the Engine effective permission view on success', () => {
        expect(
            toPermissionOverrideOutcome({
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: 'corr-permission-success',
                ok: true,
                grantedPermissions: ['filesystem.read'],
                cancelledRunIds: [],
            }),
        ).toEqual({
            ok: true,
            grantedPermissions: ['filesystem.read'],
            cancelledRunIds: [],
        });
    });

    it('keeps an unknown Plugin rejection typed and diagnostic-free', () => {
        expect(
            toPermissionOverrideOutcome({
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: 'corr-unknown-plugin',
                ok: false,
                kind: 'domain',
                code: 'unknown_plugin',
                pluginId: 'plugin-ghost',
                error: 'Plugin "plugin-ghost" is not registered in the Manifest Registry.',
            }),
        ).toEqual({
            ok: false,
            kind: 'domain',
            code: 'unknown_plugin',
            pluginId: 'plugin-ghost',
            error: 'Plugin "plugin-ghost" is not registered in the Manifest Registry.',
        });
    });

    it('preserves a registered Plugin persistence diagnostic', () => {
        const diagnostic = {
            kind: 'persistence',
            operation: 'write',
            phase: 'replace',
            path: 'C:/permission-overrides.json',
            message: 'replacement denied',
        } as const;

        expect(
            toPermissionOverrideOutcome({
                type: EngineChannel.SetPermissionOverrideResult,
                correlationId: 'corr-persistence-failed',
                ok: false,
                kind: 'persistence',
                error: '[persistence:replace] C:/permission-overrides.json: replacement denied',
                diagnostic,
            }),
        ).toEqual({
            ok: false,
            kind: 'persistence',
            error: '[persistence:replace] C:/permission-overrides.json: replacement denied',
            diagnostic,
        });
    });
});

describe('ping correlation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves when a pong with matching id is dispatched', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('ping', {}, 5000);
        const pingId = (sent[0] as Record<string, string>).correlationId;

        const pong: EnginePong = {
            correlationId: pingId,
            type: 'engine:pong',
            receivedAt: Date.now(),
        };
        client.dispatch(pong);

        const result = await promise;
        expect(result.type).toBe(EngineChannel.Pong);
        expect(result.receivedAt).toBeGreaterThan(0);
    });

    it('rejects ping on timeout', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('ping', {}, 100);
        vi.advanceTimersByTime(100);
        await expect(promise).rejects.toThrow('timed out');
    });
});

describe('rejectAll', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects all pending promises', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise1 = client.request('ping', {}, 5000);
        const promise2 = client.request('toggleWorkflow', { id: 'wf-1' }, 5000);

        client.rejectAll('worker terminated');

        await expect(promise1).rejects.toThrow('worker terminated');
        await expect(promise2).rejects.toThrow('worker terminated');
    });

    it('clears pending map after rejectAll', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.request('ping', {}, 5000);
        client.rejectAll('cleanup');
        await expect(promise).rejects.toThrow('cleanup');
        vi.advanceTimersByTime(5000);
    });

    it('settles each pending call once when worker failure and exit are both reported', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const rejected = vi.fn();

        const first = client.request('ping', {}, 5000).catch(rejected);
        const second = client.request('toggleWorkflow', { id: 'wf-1' }, 5000).catch(rejected);

        client.rejectAll('engine worker error');
        client.rejectAll('engine worker exited with code 1');

        await Promise.all([first, second]);
        expect(rejected).toHaveBeenCalledTimes(2);
    });
});

describe('dispatch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('forwards Log messages to logHandlers', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.logHandlers.add(handler);

        const log: EngineLog = { type: 'engine:log', line: 'hello' };
        client.dispatch(log);

        expect(handler).toHaveBeenCalledWith('hello');
    });

    it('forwards WorkflowsList messages to workflowsListHandlers', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.workflowsListHandlers.add(handler);

        const wf = {
            id: 'wf-1',
            name: 'Test',
            enabled: true,
            activation: { kind: 'active' } as const,
        };
        const list: EngineWorkflowsList = {
            type: 'engine:workflows-list',
            workflows: [wf],
        };
        client.dispatch(list);

        expect(handler).toHaveBeenCalledWith([wf]);
    });

    it('forwards BusEvent messages to busEventHandlers', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.busEventHandlers.add(handler);

        const bus: EngineBusEvent = {
            type: 'engine:bus-event',
            event: {
                name: 'log.output',
                payload: { message: 'hello' },
                timestamp: 1700000000000,
                telemetry: {
                    eventId: 'event-1',
                    timestamp: 1700000000000,
                    kind: 'node',
                    severity: 'info',
                    workflowId: 'workflow-1',
                    pipelineId: 'pipeline-1',
                    runId: 'run-1',
                    nodeId: 'log-node',
                    nodeType: 'log',
                    summary: '{"message":"hello"}',
                },
            },
        };
        client.dispatch(bus);

        expect(handler).toHaveBeenCalledWith(bus.event);
    });

    it('rejects malformed payloads for registered bus events', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        props.busEventHandlers.add(handler);

        client.dispatch({
            type: EngineChannel.BusEvent,
            event: { name: 'log.output', payload: { message: 42 } },
        });

        expect(handler).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid bus-event payload'));
        error.mockRestore();
    });

    it('forwards unknown bus events with opaque payloads', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.busEventHandlers.add(handler);
        const event = {
            name: 'plugin.future-event',
            payload: { arbitrary: ['data'] },
            timestamp: 1700000000000,
        };

        client.dispatch({ type: EngineChannel.BusEvent, event });

        expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not throw on an unsolicited response from worker', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const pong: EnginePong = {
            correlationId: 'ignored',
            type: 'engine:pong',
            receivedAt: Date.now(),
        };

        expect(() => client.dispatch(pong)).not.toThrow();
    });

    it('rejects and diagnoses a malformed response for the pending command', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const pending = client.request('ping', {}, 1000);
        const correlationId = (sent[0] as Record<string, string>).correlationId;

        client.dispatch({
            type: EngineChannel.Pong,
            correlationId,
        });

        vi.advanceTimersByTime(1000);
        await expect(pending).rejects.toThrow('Invalid ping response');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid message envelope'));
        error.mockRestore();
    });

    it('rejects a wrong-direction request at the Engine receive site', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const pending = client.request('toggleWorkflow', { id: 'wf-1' });
        client.dispatch(sent[0]);

        const result = await Promise.race([
            pending.then(() => 'resolved'),
            Promise.resolve('still-pending'),
        ]);

        expect(result).toBe('still-pending');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid message envelope'));

        client.rejectAll('cleanup');
        await expect(pending).rejects.toThrow('cleanup');
        error.mockRestore();
    });
});
