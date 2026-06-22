import type { CompiledPipeline } from '@sigil/schema';

import type { Bridge } from './bridge.js';
import { createBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createCapabilityBroker } from './capability-broker.js';
import { executePipeline } from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import type { ManifestRegistry } from './manifest-registry.js';
import { createManifestRegistry } from './manifest-registry.js';
import { createInMemoryPluginStateStore, createPluginLoader } from './plugin-loader.js';
import type { PluginLoader, PluginStateStore } from './plugin-loader.js';

export interface Engine {
    readonly bus: EventBus;
    readonly bridge: Bridge;
    readonly capabilityBroker: CapabilityBroker;
    readonly registry: ManifestRegistry;
    readonly loader: PluginLoader;
    readonly stateStore: PluginStateStore;
    readonly execute: (pipeline: CompiledPipeline) => void;
}

export function createEngine(): Engine {
    const bus = createEventBus();
    const registry = createManifestRegistry();
    const bridge = createBridge(bus, registry);
    const capabilityBroker = createCapabilityBroker(registry);
    const stateStore = createInMemoryPluginStateStore();
    const loader = createPluginLoader({
        bus,
        registry,
        bridge,
        broker: capabilityBroker,
        stateStore,
    });

    return {
        bus,
        bridge,
        capabilityBroker,
        registry,
        loader,
        stateStore,
        execute: (pipeline) => {
            executePipeline(pipeline, bus);
        },
    };
}
