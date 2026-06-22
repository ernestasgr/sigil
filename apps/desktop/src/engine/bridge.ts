import type { BusEvent, EventBus } from './event-bus.js';
import type { ManifestRegistry } from './manifest-registry.js';

export type EmissionResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly error: { readonly kind: 'undeclared'; readonly eventName: string };
      };

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
            if (!manifest || !manifest.emits.includes(emission.eventName)) {
                return { ok: false, error: { kind: 'undeclared', eventName: emission.eventName } };
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
            return { ok: true };
        },
        log: (pluginId, message) => {
            if (!registry.has(pluginId)) {
                return { ok: false, error: { kind: 'undeclared', eventName: 'log.output' } };
            }
            bus.next({ name: 'log.output', payload: { message } });
            return { ok: true };
        },
    };
}
