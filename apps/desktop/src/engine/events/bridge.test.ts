import {
    EventNameSchema,
    NodeTypeNameSchema,
    PluginIdSchema,
    WorkflowIdSchema,
} from '@sigil/contracts/ids';
import type { Manifest } from '@sigil/contracts/manifest';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createManifestRegistry } from '../plugins/manifest-registry.js';
import { createBridge, PluginEmissionSchema } from './bridge.js';
import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createRunTelemetry } from './telemetry.js';

const WORKFLOW_ID = WorkflowIdSchema.parse('workflow-1');
const STUB_PING_EVENT_NAME = EventNameSchema.parse('stub.ping');
const STUB_PING_PLUGIN_ID = PluginIdSchema.parse('com.sigil.stub-ping');

const stubPingManifest: Manifest = {
    id: STUB_PING_PLUGIN_ID,
    version: '0.0.1',
    permissions: [],
    emits: [STUB_PING_EVENT_NAME],
};

describe('createBridge', () => {
    it('rejects noncanonical Plugin Event names at the Bridge seam', () => {
        expect(
            PluginEmissionSchema.safeParse({ eventName: 'Stub.Ping', payload: {} }).success,
        ).toBe(false);
    });

    it('forwards a declared emission onto the bus as a plugin.event', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = await bridge.emit(STUB_PING_PLUGIN_ID, {
            eventName: STUB_PING_EVENT_NAME,
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

    it('blocks an undeclared emission before it reaches the bus', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = await bridge.emit(STUB_PING_PLUGIN_ID, {
            eventName: EventNameSchema.parse('evil.exfil'),
            payload: { secret: 'data' },
        });

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left.kind).toBe('undeclared');
            expect(result.left.eventName).toBe('evil.exfil');
        }
        expect(received).toHaveLength(0);
    });

    it('publishes Plugin events through the execution-scoped telemetry sink', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const telemetry = createRunTelemetry(
            bus,
            { workflowId: WORKFLOW_ID, pipelineId: 'pipeline-1', runId: 'run-1' },
            { now: () => 1234, createEventId: () => 'event-1' },
        );
        const node = telemetry.forNode({
            nodeId: 'plugin-node',
            nodeType: NodeTypeNameSchema.parse('plugin-node'),
            pluginId: stubPingManifest.id,
        });
        const received: BusEvent[] = [];
        bus.subscribe((event) => received.push(event));

        const result = await bridge.emit(
            stubPingManifest.id,
            { eventName: STUB_PING_EVENT_NAME, payload: { token: 'secret' } },
            node.bus,
        );

        expect(Either.isRight(result)).toBe(true);
        expect(received[0]?.telemetry).toMatchObject({
            runId: 'run-1',
            nodeId: 'plugin-node',
            pluginId: stubPingManifest.id,
            timestamp: 1234,
        });
        expect(received[0]?.telemetry?.summary).not.toContain('secret');
    });

    it('returns a failed result when an asynchronous sink rejects', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);

        const result = await bridge.emit(
            stubPingManifest.id,
            { eventName: STUB_PING_EVENT_NAME, payload: {} },
            {
                next: async () => {
                    throw new Error('sink failed');
                },
            },
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toEqual({
                kind: 'sink_failed',
                error: 'sink failed',
                eventName: 'stub.ping',
            });
        }
    });

    it('blocks an emission from an unknown plugin', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        const result = await bridge.emit(PluginIdSchema.parse('com.sigil.ghost'), {
            eventName: STUB_PING_EVENT_NAME,
            payload: {},
        });

        expect(Either.isLeft(result)).toBe(true);
        expect(received).toHaveLength(0);
    });

    it('carries the typed payload through to the subscriber', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(stubPingManifest);
        const bridge = createBridge(bus, registry);
        const received: BusEvent[] = [];
        bus.subscribe((event) => {
            received.push(event);
        });

        await bridge.emit(STUB_PING_PLUGIN_ID, {
            eventName: STUB_PING_EVENT_NAME,
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

        const result = bridge.log(STUB_PING_PLUGIN_ID, 'plugin says hi');

        expect(Either.isRight(result)).toBe(true);
        const logEvent = received.find((e) => e.name === 'log.output');
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe('plugin says hi');
    });

    it('delivers multiple events to subscribers in order', async () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        const multiManifest: Manifest = {
            id: PluginIdSchema.parse('com.sigil.multi'),
            version: '0.0.1',
            permissions: [],
            emits: [EventNameSchema.parse('a.first'), EventNameSchema.parse('a.second')],
        };
        registry.register(multiManifest);
        const bridge = createBridge(bus, registry);
        const names: string[] = [];
        bus.subscribe((event) => {
            if (event.name === 'plugin.event') {
                names.push(event.payload.eventName);
            }
        });

        const multiPluginId = multiManifest.id;
        await bridge.emit(multiPluginId, {
            eventName: EventNameSchema.parse('a.first'),
            payload: {},
        });
        await bridge.emit(multiPluginId, {
            eventName: EventNameSchema.parse('a.second'),
            payload: {},
        });

        expect(names).toEqual(['a.first', 'a.second']);
    });
});
