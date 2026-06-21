import type { CompiledPipeline } from '@sigil/schema';

import type { Bridge } from './bridge.js';
import { createStubBridge } from './bridge.js';
import type { CapabilityBroker } from './capability-broker.js';
import { createStubCapabilityBroker } from './capability-broker.js';
import { executePipeline } from './dag-executor.js';
import type { EventBus } from './event-bus.js';
import { createEventBus } from './event-bus.js';

export interface Engine {
    readonly bus: EventBus;
    readonly bridge: Bridge;
    readonly capabilityBroker: CapabilityBroker;
    readonly execute: (pipeline: CompiledPipeline) => void;
}

export function createEngine(): Engine {
    const bus = createEventBus();
    const bridge = createStubBridge(bus);
    const capabilityBroker = createStubCapabilityBroker();

    return {
        bus,
        bridge,
        capabilityBroker,
        execute: (pipeline) => {
            executePipeline(pipeline, bus);
        },
    };
}
