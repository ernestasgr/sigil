import type { Manifest } from '@sigil/schema/manifest';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createBridge } from './bridge.js';
import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createManifestRegistry } from './manifest-registry.js';

const stubPingManifest: Manifest = {
    id: 'com.sigil.stub-ping',
    version: '0.0.1',
    permissions: [],
    emits: ['stub.ping'],
};

describe('createBridge', () => {
    it('forwards a declared emission onto the bus as a plugin.event', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = bridge.emit('com.sigil.stub-ping', {
            eventName: 'stub.ping',
            payload: { message: 'hello' },
        });

        expect(Either.isRight(result)).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0]?.name).toBe('plugin.event');
        if (received[0]?.name === 'plugin.event') {
            expect(received[0].payload.pluginId).toBe('com.sigil.stub-ping');
            expect(received[0].payload.eventName).toBe('stub.ping');
            expect(received[0].payload.data).toEqual({ message: 'hello' });
        }
    });

    it('blocks an undeclared emission before it reaches the bus', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = bridge.emit('com.sigil.stub-ping', {
            eventName: 'evil.exfil',
            payload: { secret: 'data' },
        });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.kind).toBe('undeclared');
            expect(result.left.eventName).toBe('evil.exfil');
        }
        expect(received).toHaveLength(0);
    });

    it('blocks an emission from an unknown plugin', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = bridge.emit('com.sigil.ghost', {
            eventName: 'stub.ping',
            payload: {},
        });

        expect(Either.isLeft(result)).toBe(true);
        expect(received).toHaveLength(0);
    });

    it('carries the typed payload through to the subscriber', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        bridge.emit('com.sigil.stub-ping', {
            eventName: 'stub.ping',
            payload: { message: 'hello sigil' },
        });

        const event = received[0];
        expect(event?.name).toBe('plugin.event');
        if (event?.name === 'plugin.event') {
            expect(event.payload.data).toEqual({ message: 'hello sigil' });
        }
    });

    it('forwards a log call as a log.output event on the bus', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = bridge.log('com.sigil.stub-ping', 'plugin says hi');

        expect(Either.isRight(result)).toBe(true);
        const logEvent = received.find((e) => e.name === 'log.output');
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe('plugin says hi');
    });

    it('delivers multiple events to subscribers in order', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        const multiManifest: Manifest = {
            id: 'com.sigil.multi',
            version: '0.0.1',
            permissions: [],
            emits: ['a.first', 'a.second'],
        };
        registry.register(multiManifest);
        const bridge = createBridge(bus, registry);
        const names: string[] = [];
        bus.subscribe((event) => {
            if (event.name === 'plugin.event') {
                names.push(event.payload.eventName);
            }
        });

        bridge.emit('com.sigil.multi', { eventName: 'a.first', payload: {} });
        bridge.emit('com.sigil.multi', { eventName: 'a.second', payload: {} });

        expect(names).toEqual(['a.first', 'a.second']);
    });
});
