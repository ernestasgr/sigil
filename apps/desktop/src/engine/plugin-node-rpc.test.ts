import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { loadNodePlugin } from './node-plugin-loader.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import {
    NodePluginDepsRpcSchema,
    NodePluginMainToWorkerSchema,
    NodePluginWorkerKind,
    NodePluginWorkerToMainSchema,
} from './plugin-node-rpc.js';

const workflowContext = { event: 'file.created', payload: {}, vars: {} };

const PROXIED_DEPENDENCY_HANDLER = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: 'rpc-execution' as const,
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'] as const,
};

export const handler = {
    async execute({ ctx }, deps) {
        await deps.sleep(0);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`;

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
        operation: 'event.emit',
        args: ['plugin.output', { message: 'hello' }],
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
        args: ['state.read'],
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

    it('rejects extra operation envelope fields instead of silently stripping them', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'state.get',
            args: ['key'],
            pluginId: 'com.sigil.authorized',
        });

        expect(parsed.success).toBe(false);
    });

    it('rejects an empty operation request id', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: '',
            operation: 'state.get',
            args: ['key'],
        });

        expect(parsed.success).toBe(false);
    });

    it('rejects a direct Event Bus operation', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'bus.next',
            args: [{ name: 'notification.show', payload: { title: 'forged', body: 'forged' } }],
        });

        expect(parsed.success).toBe(false);
    });

    it('rejects an event emission without a non-empty name and object payload', () => {
        const emptyName = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'event.emit',
            args: ['', {}],
        });
        const nonObjectPayload = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:2',
            operation: 'event.emit',
            args: ['plugin.output', []],
        });

        expect(emptyName.success).toBe(false);
        expect(nonObjectPayload.success).toBe(false);
    });

    it('rejects a capability request that carries Plugin-controlled identity', () => {
        const parsed = NodePluginDepsRpcSchema.safeParse({
            kind: NodePluginWorkerKind.DepsRpc,
            requestId: 'request:1',
            operation: 'capabilityBroker.request',
            args: [{ pluginId: 'com.sigil.authorized', capability: 'state.read' }],
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

    it('correlates an independent worker dependency RPC with its execute request', async () => {
        const pluginDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-rpc-correlation-'));
        try {
            writeFileSync(
                join(pluginDir, 'plugin.manifest.json'),
                JSON.stringify({
                    id: 'com.sigil.rpc-execution',
                    version: '0.0.1',
                    permissions: [],
                    emits: ['rpc.output'],
                    nodeType: 'rpc-execution',
                }),
            );
            writeFileSync(join(pluginDir, 'handler.ts'), PROXIED_DEPENDENCY_HANDLER);

            const manifestRegistry = createManifestRegistry();
            const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
            });

            expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get('rpc-execution'));
            const output = await handler.execute(
                {
                    node: {
                        id: 'n1',
                        type: 'rpc-execution',
                        pluginId: 'com.sigil.rpc-execution',
                        config: {},
                    },
                    ctx: workflowContext,
                },
                { sleep: async () => undefined } as never,
            );

            expect(output.activePort).toBe('out');
            expect(output.outputCtx).toEqual(workflowContext);
        } finally {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });
});
