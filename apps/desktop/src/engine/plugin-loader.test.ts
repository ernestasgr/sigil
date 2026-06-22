import { describe, expect, it, vi } from 'vitest';

import { stubPingCode, stubPingManifest } from './stub-plugin.js';
import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createBridge } from './bridge.js';
import { createCapabilityBroker } from './capability-broker.js';
import { createManifestRegistry } from './manifest-registry.js';
import {
    createInMemoryPluginStateStore,
    createPluginLoader,
    handleRpcRequest,
    type PluginLoaderDeps,
} from './plugin-loader.js';
import type { PluginRpcRequest } from './plugin-rpc.js';
import { PluginRpcKind } from './plugin-rpc.js';

function createTestStack(): PluginLoaderDeps & {
    bus: ReturnType<typeof createEventBus>;
    loader: ReturnType<typeof createPluginLoader>;
} {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const bridge = createBridge(bus, registry);
    const broker = createCapabilityBroker(registry);
    const stateStore = createInMemoryPluginStateStore();
    const loader = createPluginLoader({ bus, registry, bridge, broker, stateStore });
    return { bus, registry, bridge, broker, stateStore, loader };
}

function createRoutingStack(): PluginLoaderDeps & {
    bus: ReturnType<typeof createEventBus>;
} {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    registry.register(stubPingManifest);
    const bridge = createBridge(bus, registry);
    const broker = createCapabilityBroker(registry);
    const stateStore = createInMemoryPluginStateStore();
    return { bus, registry, bridge, broker, stateStore };
}

function pluginEvents(events: BusEvent[]): BusEvent[] {
    return events.filter((e) => e.name === 'plugin.event');
}

describe('plugin isolation integration', () => {
    it('loads the stub plugin through a worker_thread + vm.Context and receives its declared event on the bus', async () => {
        const stack = createTestStack();
        const events: BusEvent[] = [];
        stack.bus.subscribe((event) => {
            events.push(event);
        });

        const result = await stack.loader.load(stubPingManifest, stubPingCode);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        await vi.waitFor(
            () => {
                const ping = events.find(
                    (e) => e.name === 'plugin.event' && e.payload.eventName === 'stub.ping',
                );
                expect(ping).toBeDefined();
            },
            { timeout: 10000, interval: 100 },
        );

        const pingEvent = events.find(
            (e) => e.name === 'plugin.event' && e.payload.eventName === 'stub.ping',
        );
        expect(pingEvent?.name === 'plugin.event' && pingEvent.payload.data).toEqual({
            message: 'hello from stub plugin',
            lastRun: 12345,
        });

        const logEvent = events.find((e) => e.name === 'log.output');
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'stub-ping plugin starting',
        );

        expect(stack.stateStore.get('com.sigil.stub-ping', 'lastRun')).toBe(12345);

        await result.handle.terminate();
    }, 15000);

    it('refuses to load a plugin with an invalid manifest', async () => {
        const { loader } = createTestStack();

        const result = await loader.load({ id: 'broken' }, 'log("hi")');

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('invalid_manifest');
        }
    });

    it('refuses to load a duplicate plugin', async () => {
        const { registry, loader } = createTestStack();
        registry.register(stubPingManifest);

        const result = await loader.load(stubPingManifest, stubPingCode);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('duplicate');
        }
    });

    it('recovers from a worker error and reloads on retry', async () => {
        const stack = createTestStack();

        const firstResult = await stack.loader.load(stubPingManifest, 'function {');

        expect(firstResult.ok).toBe(false);
        if (!firstResult.ok) {
            expect(firstResult.error.kind).toBe('worker_error');
        }

        const secondResult = await stack.loader.load(stubPingManifest, stubPingCode);

        expect(secondResult.ok).toBe(true);
        if (secondResult.ok) {
            await secondResult.handle.terminate();
        }
    }, 15000);
});

describe('handleRpcRequest routing', () => {
    it('routes an event.emit RPC through the bridge and onto the bus', () => {
        const stack = createRoutingStack();
        const events: BusEvent[] = [];
        stack.bus.subscribe((e) => events.push(e));

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.EventEmit,
            requestId: 'r1',
            pluginId: 'com.sigil.stub-ping',
            eventName: 'stub.ping',
            payload: { message: 'routed' },
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(true);
        expect(pluginEvents(events)).toHaveLength(1);
    });

    it('blocks an undeclared event.emit RPC at the bridge', () => {
        const stack = createRoutingStack();
        const events: BusEvent[] = [];
        stack.bus.subscribe((e) => events.push(e));

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.EventEmit,
            requestId: 'r2',
            pluginId: 'com.sigil.stub-ping',
            eventName: 'evil.exfil',
            payload: {},
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(false);
        expect(events).toHaveLength(0);
    });

    it('routes a state.set RPC to the state store', () => {
        const stack = createRoutingStack();

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateSet,
            requestId: 'r3',
            pluginId: 'com.sigil.stub-ping',
            key: 'counter',
            value: 42,
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(true);
        expect(stack.stateStore.get('com.sigil.stub-ping', 'counter')).toBe(42);
    });

    it('routes a state.get RPC and returns the stored value', () => {
        const stack = createRoutingStack();
        stack.stateStore.set('com.sigil.stub-ping', 'name', 'sigil');

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateGet,
            requestId: 'r4',
            pluginId: 'com.sigil.stub-ping',
            key: 'name',
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(true);
        if (response.ok) {
            expect(response.value).toBe('sigil');
        }
    });

    it('routes a log RPC through the bridge as a log.output bus event', () => {
        const stack = createRoutingStack();
        const events: BusEvent[] = [];
        stack.bus.subscribe((e) => events.push(e));

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.Log,
            requestId: 'r5',
            pluginId: 'com.sigil.stub-ping',
            message: 'log via rpc',
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(true);
        const logEvent = events.find((e) => e.name === 'log.output');
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe('log via rpc');
    });
});
