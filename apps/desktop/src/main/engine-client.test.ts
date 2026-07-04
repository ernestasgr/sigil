import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
    EngineChannel,
    type EngineBusEvent,
    type EngineGetWorkflowResult,
    type EngineLog,
    type EngineMessage,
    type EnginePong,
    type EngineToggleWorkflowResult,
    type EngineWorkflowsList,
} from '../shared/ipc-channels.js';

import { createRpcClient, type RpcClientProps } from './engine-client.js';

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

        client.rpc<void>(EngineChannel.ToggleWorkflow, { id: 'wf-1' }, 5000);

        expect(sent).toHaveLength(1);
        const msg = sent[0] as Record<string, unknown>;
        expect(msg).toMatchObject({
            type: EngineChannel.ToggleWorkflow,
            id: 'wf-1',
        });
        expect(msg).toHaveProperty('correlationId');
        expect(typeof msg.correlationId).toBe('string');
    });

    it('resolves the promise when a matching response with correlationId is dispatched', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EngineToggleWorkflowResult>(
            EngineChannel.ToggleWorkflow,
            { id: 'wf-1' },
            5000,
        );

        const correlationId = (sent[0] as Record<string, string>).correlationId;

        const response: EngineToggleWorkflowResult = {
            type: EngineChannel.ToggleWorkflowResult,
            correlationId,
            summary: { id: 'wf-1', name: 'My Workflow', enabled: true },
        };
        client.dispatch(response);

        const result = await promise;
        expect(result.summary).toEqual({
            id: 'wf-1',
            name: 'My Workflow',
            enabled: true,
        });
    });

    it('ignores non-matching messages (different correlationId)', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EngineToggleWorkflowResult>(
            EngineChannel.ToggleWorkflow,
            { id: 'wf-1' },
            5000,
        );

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

    it('rejects the promise on timeout', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EnginePong>(EngineChannel.Ping, {}, 1000);

        vi.advanceTimersByTime(1000);

        await expect(promise).rejects.toThrow('timed out');
    });

    it('cleans up the pending entry on timeout', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EnginePong>(EngineChannel.Ping, {}, 1000);
        vi.advanceTimersByTime(1000);
        await expect(promise).rejects.toThrow();

        const id = (sent[0] as Record<string, string>).correlationId;
        const lateResponse: EnginePong = {
            id,
            type: EngineChannel.Pong,
            receivedAt: Date.now(),
        };
        client.dispatch(lateResponse);
    });
});

describe('ping (uses id field instead of correlationId)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves when a pong with matching id is dispatched', async () => {
        const { props, sent } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EnginePong>(EngineChannel.Ping, {}, 5000, 'id');
        const pingId = (sent[0] as Record<string, string>).id;

        const pong: EnginePong = {
            id: pingId,
            type: EngineChannel.Pong,
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

        const promise = client.rpc<EnginePong>(EngineChannel.Ping, {}, 100, 'id');
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

        const promise1 = client.rpc<EnginePong>(EngineChannel.Ping, {}, 5000, 'id');
        const promise2 = client.rpc<EngineToggleWorkflowResult>(
            EngineChannel.ToggleWorkflow,
            { id: 'wf-1' },
            5000,
        );

        client.rejectAll('worker terminated');

        await expect(promise1).rejects.toThrow('worker terminated');
        await expect(promise2).rejects.toThrow('worker terminated');
    });

    it('clears pending map after rejectAll', async () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const promise = client.rpc<EnginePong>(EngineChannel.Ping, {}, 5000, 'id');
        client.rejectAll('cleanup');
        await expect(promise).rejects.toThrow('cleanup');
        vi.advanceTimersByTime(5000);
    });
});

describe('dispatch', () => {
    it('forwards Log messages to logHandlers', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.logHandlers.add(handler);

        const log: EngineLog = { type: EngineChannel.Log, line: 'hello' };
        client.dispatch(log);

        expect(handler).toHaveBeenCalledWith('hello');
    });

    it('forwards WorkflowsList messages to workflowsListHandlers', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);
        const handler = vi.fn();
        props.workflowsListHandlers.add(handler);

        const wf = { id: 'wf-1', name: 'Test', enabled: true };
        const list: EngineWorkflowsList = {
            type: EngineChannel.WorkflowsList,
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
            type: EngineChannel.BusEvent,
            event: { name: 'test', payload: { x: 1 } },
        };
        client.dispatch(bus);

        expect(handler).toHaveBeenCalledWith({ name: 'test', payload: { x: 1 } });
    });

    it('does not throw on unexpected request-type messages from worker', () => {
        const { props } = buildProps();
        const client = createRpcClient(props);

        const ping: EngineMessage = {
            id: 'ignored',
            type: EngineChannel.Ping,
        } as EngineMessage;

        expect(() => client.dispatch(ping)).not.toThrow();
    });
});
