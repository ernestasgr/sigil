import type { BusEvent } from './event-bus.js';
import type { EventBus } from './event-bus.js';

export interface Bridge {
    readonly emit: (event: BusEvent) => void;
}

export function createStubBridge(bus: EventBus): Bridge {
    return {
        emit: (event) => {
            bus.next(event);
        },
    };
}
