import { Either, Option } from 'effect';
import type { BusEvent, EventBus } from './event-bus.js';
import type { ManifestRegistry } from './manifest-registry.js';

export type EmissionError = { readonly kind: 'undeclared'; readonly eventName: string };
export type EmissionResult = Either.Either<void, EmissionError>;

export type BridgeEmissionResult = EmissionResult;

export interface PluginEmission {
    readonly eventName: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface Bridge {
    readonly emit: (pluginId: string, emission: PluginEmission) => BridgeEmissionResult;
    readonly log: (pluginId: string, message: string) => EmissionResult;
}

export function createBridge(bus: EventBus, registry: ManifestRegistry): Bridge {
    return {
        emit: (pluginId, emission) => {
            const manifest = registry.get(pluginId);
            if (Option.isNone(manifest) || !manifest.value.emits.includes(emission.eventName)) {
                return Either.left({ kind: 'undeclared', eventName: emission.eventName });
            }
            const event: BusEvent = {
                name: 'plugin.event',
                payload: {
                    pluginId,
                    eventName: emission.eventName,
                    data: emission.payload,
                },
            };
            bus.next(event);
            return Either.right(undefined);
        },
        log: (pluginId, message) => {
            if (!registry.has(pluginId)) {
                return Either.left({ kind: 'undeclared', eventName: 'log.output' });
            }
            bus.next({ name: 'log.output', payload: { message } });
            return Either.right(undefined);
        },
    };
}
