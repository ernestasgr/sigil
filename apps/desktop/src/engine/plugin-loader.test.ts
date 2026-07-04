import { describe, expect, it, vi } from 'vitest';

import { stubPingCode, stubPingManifest } from './stub-plugin.js';
import type { Manifest } from '@sigil/schema/manifest';
import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createBridge } from './bridge.js';
import { createCapabilityBroker } from './capability-broker.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createPermissionOverrideStore } from './permission-override-store.js';
import {
    createInMemoryPluginStateStore,
    createPluginLoader,
    handleRpcRequest,
    type PluginLoaderDeps,
} from './plugin-loader.js';
import { PluginToEngineMessageSchema, type PluginRpcRequest } from './plugin-rpc.js';
import { PluginRpcKind } from './plugin-rpc.js';

function createTestStack(): PluginLoaderDeps & {
    bus: ReturnType<typeof createEventBus>;
    loader: ReturnType<typeof createPluginLoader>;
} {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const bridge = createBridge(bus, registry);
    const overrides = createPermissionOverrideStore();
    const broker = createCapabilityBroker(registry, overrides);
    const stateStore = createInMemoryPluginStateStore();
    const loader = createPluginLoader({ bus, registry, bridge, broker, stateStore });
    return { bus, registry, bridge, broker, stateStore, loader };
}

function createRoutingStack(): PluginLoaderDeps & {
    bus: ReturnType<typeof createEventBus>;
    permissionOverrides: ReturnType<typeof createPermissionOverrideStore>;
} {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    registry.register(stubPingManifest);
    const bridge = createBridge(bus, registry);
    const overrides = createPermissionOverrideStore();
    const broker = createCapabilityBroker(registry, overrides);
    const stateStore = createInMemoryPluginStateStore();
    return { bus, registry, bridge, broker, stateStore, permissionOverrides: overrides };
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

    it('denies state.get for a plugin without state.read permission', () => {
        const stack = createRoutingStack();
        stack.registry.unregister('com.sigil.stub-ping');
        const noPermManifest: Manifest = {
            id: 'com.sigil.no-state',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        };
        stack.registry.register(noPermManifest);

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateGet,
            requestId: 'r6',
            pluginId: 'com.sigil.no-state',
            key: 'secret',
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(false);
        if (!response.ok) {
            expect(response.error).toBe('denied');
        }
    });

    it('denies state.set for a plugin without state.write permission', () => {
        const stack = createRoutingStack();
        stack.registry.unregister('com.sigil.stub-ping');
        const noPermManifest: Manifest = {
            id: 'com.sigil.no-state',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        };
        stack.registry.register(noPermManifest);

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateSet,
            requestId: 'r7',
            pluginId: 'com.sigil.no-state',
            key: 'x',
            value: 1,
        };

        const response = handleRpcRequest(request, stack);

        expect(response.ok).toBe(false);
        if (!response.ok) {
            expect(response.error).toBe('denied');
        }
    });

    it('allows state.get and state.set when the manifest grants the permissions', () => {
        const stack = createRoutingStack();

        const getRequest: PluginRpcRequest = {
            kind: PluginRpcKind.StateGet,
            requestId: 'r8',
            pluginId: 'com.sigil.stub-ping',
            key: 'counter',
        };

        const getResponse = handleRpcRequest(getRequest, stack);
        expect(getResponse.ok).toBe(true);

        const setRequest: PluginRpcRequest = {
            kind: PluginRpcKind.StateSet,
            requestId: 'r9',
            pluginId: 'com.sigil.stub-ping',
            key: 'counter',
            value: 42,
        };

        const setResponse = handleRpcRequest(setRequest, stack);
        expect(setResponse.ok).toBe(true);
        expect(stack.stateStore.get('com.sigil.stub-ping', 'counter')).toBe(42);
    });

    it('re-checks permission on every call: revoke between two consecutive RPCs sees the second denied', () => {
        const stack = createRoutingStack();

        const setRequest: PluginRpcRequest = {
            kind: PluginRpcKind.StateSet,
            requestId: 'r10',
            pluginId: 'com.sigil.stub-ping',
            key: 'counter',
            value: 1,
        };

        const firstResponse = handleRpcRequest(setRequest, stack);
        expect(firstResponse.ok).toBe(true);

        stack.permissionOverrides.set('com.sigil.stub-ping', []);

        const secondResponse = handleRpcRequest(setRequest, stack);
        expect(secondResponse.ok).toBe(false);
        if (!secondResponse.ok) {
            expect(secondResponse.error).toBe('denied');
        }
    });

    it('does not mutate state store when state.set is denied', () => {
        const stack = createRoutingStack();
        stack.registry.unregister('com.sigil.stub-ping');
        const noPermManifest: Manifest = {
            id: 'com.sigil.no-state',
            version: '0.0.1',
            permissions: [],
            emits: ['stub.ping'],
        };
        stack.registry.register(noPermManifest);

        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateSet,
            requestId: 'r11',
            pluginId: 'com.sigil.no-state',
            key: 'should-not-exist',
            value: 'leaked',
        };

        handleRpcRequest(request, stack);

        expect(stack.stateStore.get('com.sigil.no-state', 'should-not-exist')).toBeUndefined();
    });
});

describe('envelope validation', () => {
    it('rejects a malformed PluginToEngineMessage', () => {
        const malformed = { kind: 'plugin:unknown', payload: 'garbage' };
        const result = PluginToEngineMessageSchema.safeParse(malformed);
        expect(result.success).toBe(false);
    });

    it('rejects a null/undefined message', () => {
        expect(PluginToEngineMessageSchema.safeParse(null).success).toBe(false);
        expect(PluginToEngineMessageSchema.safeParse(undefined).success).toBe(false);
    });

    it('accepts a valid PluginRpcRequest', () => {
        const request: PluginRpcRequest = {
            kind: PluginRpcKind.StateGet,
            requestId: 'r1',
            pluginId: 'com.sigil.stub-ping',
            key: 'counter',
        };
        const result = PluginToEngineMessageSchema.safeParse(request);
        expect(result.success).toBe(true);
    });

    it('accepts a valid plugin:ready message', () => {
        const result = PluginToEngineMessageSchema.safeParse({
            kind: 'plugin:ready',
            pluginId: 'com.sigil.stub-ping',
        });
        expect(result.success).toBe(true);
    });
});
