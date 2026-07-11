import { describe, expect, it } from 'vitest';

import {
    NodePluginDepsRpcSchema,
    NodePluginMainToWorkerSchema,
    NodePluginWorkerKind,
    NodePluginWorkerToMainSchema,
} from './plugin-node-rpc.js';

const workflowContext = { event: 'file.created', payload: {}, vars: {} };

function createFakeMessagePair(): {
    readonly postMessage: (message: unknown) => void;
    readonly onMessage: (listener: (message: unknown) => void) => void;
} {
    const listeners = new Set<(message: unknown) => void>();
    return {
        postMessage: (message) => {
            for (const listener of listeners) listener(message);
        },
        onMessage: (listener) => {
            listeners.add(listener);
        },
    };
}

const validCalls = [
    {
        operation: 'bus.next',
        args: [{ name: 'log.output', payload: { message: 'hello' } }],
    },
    { operation: 'sleep', args: [10] },
    { operation: 'resolveTemplate', args: ['{{path}}', workflowContext] },
    {
        operation: 'evaluateCondition',
        args: [{ target: 'event', operator: 'equals', value: 'file.created' }, workflowContext],
    },
    {
        operation: 'matchSwitchCase',
        args: [{ target: 'event', cases: ['file.created'] }, workflowContext],
    },
    { operation: 'state.get', args: ['key'] },
    { operation: 'state.set', args: ['key', 'value'] },
    { operation: 'state.flush', args: [] },
    {
        operation: 'capabilityBroker.request',
        args: [{ pluginId: 'com.sigil.test', capability: 'state.read' }],
    },
    {
        operation: 'fileWatcherManager.registerSubscriber',
        args: [
            { id: 'subscriber', path: '/', recursive: true, events: ['file.created'] },
            'callback:1',
        ],
    },
    { operation: 'fileWatcherManager.unregisterSubscriber', args: ['subscriber'] },
] as const;

describe('NodePluginDepsRpcSchema', () => {
    it.each(validCalls)('accepts the closed $operation operation', (call) => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            ...call,
        });

        expect(parsed.success).toBe(true);
    });

    it('rejects an operation that is not part of the transport vocabulary', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'deps.typo',
            args: [],
        });

        expect(parsed.success).toBe(false);
    });

    it('rejects a supported operation with the wrong argument shape', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'state.set',
            args: ['key'],
        });

        expect(parsed.success).toBe(false);
    });

    it('does not accept the legacy reflective method envelope', () => {
        const parsed = NodePluginWorkerToMainSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            method: 'state.get',
            args: ['key'],
        });

        expect(parsed.success).toBe(false);
    });

    it('correlates result and error responses through the fake message pair', () => {
        const pair = createFakeMessagePair();
        const settled: string[] = [];
        const pending = new Map<string, (outcome: string) => void>([
            ['request:success', (outcome) => settled.push(outcome)],
            ['request:error', (outcome) => settled.push(outcome)],
        ]);

        pair.onMessage((raw) => {
            const parsed = NodePluginMainToWorkerSchema.safeParse(raw);
            if (!parsed.success) return;
            if (
                parsed.data.kind !== NodePluginWorkerKind.DepsRpcResult &&
                parsed.data.kind !== NodePluginWorkerKind.DepsRpcError
            ) {
                return;
            }

            const resolve = pending.get(parsed.data.requestId);
            if (!resolve) return;
            pending.delete(parsed.data.requestId);
            resolve(
                parsed.data.kind === NodePluginWorkerKind.DepsRpcResult
                    ? 'resolved'
                    : `rejected: ${parsed.data.error}`,
            );
        });

        pair.postMessage({
            kind: NodePluginWorkerKind.DepsRpcResult,
            requestId: 'request:success',
            value: 'value',
        });
        pair.postMessage({
            kind: NodePluginWorkerKind.DepsRpcError,
            requestId: 'request:error',
            error: 'failed',
        });

        expect(settled).toEqual(['resolved', 'rejected: failed']);
        expect(pending).toHaveLength(0);
    });
});
