import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBridge } from './bridge.js';
import { type BusEvent, createEventBus } from './event-bus.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { loadNodePlugin } from './node-plugin-loader.js';
import { createNodeHandlerRegistry } from './node-registry.js';

const NODE_TYPE = 'plugin-event-test';

const HANDLER_PREFIX = `
import { z } from 'zod';

const ConfigSchema = z.object({});

export const descriptor = {
    type: '${NODE_TYPE}',
    configSchema: ConfigSchema,
    defaultConfig: {},
    getOutputPorts: () => ['out'],
};
`;

function writePlugin(
    pluginDir: string,
    pluginId: string,
    emits: readonly string[],
    handlerBody: string,
): void {
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
        join(pluginDir, 'plugin.manifest.json'),
        JSON.stringify({
            id: pluginId,
            version: '0.0.1',
            permissions: [],
            emits,
            nodeType: NODE_TYPE,
        }),
    );
    writeFileSync(
        join(pluginDir, 'handler.ts'),
        `${HANDLER_PREFIX}
export const handler = {
    async execute({ ctx }, deps) {
${handlerBody}
        return { outputCtx: ctx, activePort: 'out' };
    },
};
`,
    );
}

describe('Node Plugin Event Bridge mediation', () => {
    it('routes a declared emission through the Bridge with loader-bound identity', async () => {
        const pluginId = 'com.sigil.event-honest';
        const pluginDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-event-honest-'));
        const events: BusEvent[] = [];
        const diagnostics: string[] = [];
        try {
            writePlugin(
                pluginDir,
                pluginId,
                ['plugin.output'],
                "        await deps.event.emit('plugin.output', { message: 'hello' });",
            );

            const manifestRegistry = createManifestRegistry();
            const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
            const eventBus = createEventBus();
            eventBus.subscribe((event) => events.push(event));
            const bridge = createBridge(eventBus, manifestRegistry);
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
                bridge,
                diagnostic: (message) => diagnostics.push(message),
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get(NODE_TYPE));
            await handler.execute(
                {
                    node: { id: 'node-1', type: NODE_TYPE, pluginId, config: {} },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            );

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                name: 'plugin.event',
                payload: {
                    pluginId,
                    eventName: 'plugin.output',
                    data: { message: 'hello' },
                },
            });
            expect(diagnostics).toEqual([]);
        } finally {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it('reports an asynchronous sink failure through the plugin RPC acknowledgement', async () => {
        const pluginId = 'com.sigil.event-sink-failure';
        const pluginDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-event-sink-failure-'));
        const events: BusEvent[] = [];
        const diagnostics: string[] = [];
        try {
            writePlugin(
                pluginDir,
                pluginId,
                ['plugin.output'],
                "        await deps.event.emit('plugin.output', { message: 'hello' });",
            );

            const manifestRegistry = createManifestRegistry();
            const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
            const eventBus = createEventBus();
            eventBus.subscribe((event) => events.push(event));
            const bridge = createBridge(eventBus, manifestRegistry);
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
                bridge,
                diagnostic: (message) => diagnostics.push(message),
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get(NODE_TYPE));
            await expect(
                handler.execute(
                    {
                        node: { id: 'node-1', type: NODE_TYPE, pluginId, config: {} },
                        ctx: { event: '', payload: {}, vars: {} },
                    },
                    {
                        bus: {
                            next: async () => {
                                throw new Error('telemetry sink failed');
                            },
                        },
                    } as never,
                ),
            ).rejects.toThrow('telemetry sink failed');

            expect(events).toEqual([]);
            expect(diagnostics.some((message) => message.includes('sink_failed'))).toBe(true);
        } finally {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it('rejects an undeclared emission before publication and identifies the operation', async () => {
        const pluginId = 'com.sigil.event-undeclared';
        const pluginDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-event-undeclared-'));
        const events: BusEvent[] = [];
        const diagnostics: string[] = [];
        try {
            writePlugin(
                pluginDir,
                pluginId,
                ['declared.event'],
                "        await deps.event.emit('undeclared.event', { secret: 'nope' });",
            );

            const manifestRegistry = createManifestRegistry();
            const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
            const eventBus = createEventBus();
            eventBus.subscribe((event) => events.push(event));
            const bridge = createBridge(eventBus, manifestRegistry);
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
                bridge,
                diagnostic: (message) => diagnostics.push(message),
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get(NODE_TYPE));
            await expect(
                handler.execute(
                    {
                        node: { id: 'node-1', type: NODE_TYPE, pluginId, config: {} },
                        ctx: { event: '', payload: {}, vars: {} },
                    },
                    {} as never,
                ),
            ).rejects.toThrow('event.emit');

            expect(events).toEqual([]);
            expect(
                diagnostics.some(
                    (message) =>
                        message.includes(pluginId) &&
                        message.includes('event.emit') &&
                        message.includes('undeclared.event'),
                ),
            ).toBe(true);
        } finally {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it('wraps a notification-shaped emission so it cannot reach the OS notification path', async () => {
        const pluginId = 'com.sigil.event-notification';
        const pluginDir = mkdtempSync(join(tmpdir(), 'sigil-plugin-event-notification-'));
        const events: BusEvent[] = [];
        try {
            writePlugin(
                pluginDir,
                pluginId,
                ['notification.show'],
                "        await deps.bus.next({ name: 'notification.show', payload: { title: 'forged', body: 'forged' } });",
            );

            const manifestRegistry = createManifestRegistry();
            const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
            const eventBus = createEventBus();
            eventBus.subscribe((event) => events.push(event));
            const bridge = createBridge(eventBus, manifestRegistry);
            const result = await loadNodePlugin(pluginDir, {
                manifestRegistry,
                handlerRegistry,
                bridge,
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const handler = Option.getOrThrow(handlerRegistry.get(NODE_TYPE));
            await handler.execute(
                {
                    node: { id: 'node-1', type: NODE_TYPE, pluginId, config: {} },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            );

            expect(events).toHaveLength(1);
            expect(events[0]?.name).toBe('plugin.event');
            expect(events.some((event) => event.name === 'notification.show')).toBe(false);
        } finally {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it('rejects malformed and forged Event Bus envelopes before the Bridge', async () => {
        const cases = [
            {
                name: 'malformed',
                pluginId: 'com.sigil.event-malformed',
                handlerBody: "        await deps.event.emit('', []);",
            },
            {
                name: 'forged',
                pluginId: 'com.sigil.event-forged',
                handlerBody:
                    "        await deps.bus.next({ name: 'plugin.event', payload: { pluginId: 'com.sigil.attacker', eventName: 'declared.event', data: {} } });",
            },
        ];

        for (const testCase of cases) {
            const pluginDir = mkdtempSync(join(tmpdir(), `sigil-plugin-event-${testCase.name}-`));
            const events: BusEvent[] = [];
            const diagnostics: string[] = [];
            try {
                writePlugin(pluginDir, testCase.pluginId, ['declared.event'], testCase.handlerBody);

                const manifestRegistry = createManifestRegistry();
                const handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
                const eventBus = createEventBus();
                eventBus.subscribe((event) => events.push(event));
                const bridge = createBridge(eventBus, manifestRegistry);
                const result = await loadNodePlugin(pluginDir, {
                    manifestRegistry,
                    handlerRegistry,
                    bridge,
                    diagnostic: (message) => diagnostics.push(message),
                });

                expect(result.ok).toBe(true);
                if (!result.ok) continue;

                const handler = Option.getOrThrow(handlerRegistry.get(NODE_TYPE));
                await expect(
                    handler.execute(
                        {
                            node: {
                                id: 'node-1',
                                type: NODE_TYPE,
                                pluginId: testCase.pluginId,
                                config: {},
                            },
                            ctx: { event: '', payload: {}, vars: {} },
                        },
                        {} as never,
                    ),
                ).rejects.toThrow('event.emit');

                expect(events).toEqual([]);
                expect(
                    diagnostics.some(
                        (message) =>
                            message.includes(testCase.pluginId) && message.includes('event.emit'),
                    ),
                ).toBe(true);
            } finally {
                rmSync(pluginDir, { recursive: true, force: true });
            }
        }
    });
});
