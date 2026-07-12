import { Either, Option } from 'effect';
import { z } from 'zod';
import type { BusEvent, EventBus, EventSink } from './event-bus.js';
import type { ManifestRegistry } from './manifest-registry.js';

export type EmissionError =
    | { readonly kind: 'malformed'; readonly error: string; readonly eventName: string }
    | { readonly kind: 'undeclared'; readonly eventName: string };
export type EmissionResult = Either.Either<void, EmissionError>;

export type BridgeEmissionResult = EmissionResult;

export const PluginEmissionSchema = z
    .object({
        eventName: z.string().min(1),
        payload: z.record(z.string(), z.unknown()),
    })
    .readonly();
export type PluginEmission = z.infer<typeof PluginEmissionSchema>;

export interface Bridge {
    readonly emit: (
        pluginId: string,
        emission: PluginEmission,
        sink?: EventSink,
    ) => BridgeEmissionResult;
    readonly log: (pluginId: string, message: string) => EmissionResult;
}

export function createBridge(bus: EventBus, registry: ManifestRegistry): Bridge {
    return {
        emit: (pluginId, emission, sink) => {
            const parsedEmission = PluginEmissionSchema.safeParse(emission);
            if (!parsedEmission.success) {
                return Either.left({
                    kind: 'malformed',
                    error: parsedEmission.error.message,
                    eventName: '',
                });
            }

            const { eventName, payload } = parsedEmission.data;
            const manifest = registry.get(pluginId);
            if (Option.isNone(manifest) || !manifest.value.emits.includes(eventName)) {
                return Either.left({ kind: 'undeclared', eventName });
            }
            const event: BusEvent = {
                name: 'plugin.event',
                payload: {
                    pluginId,
                    eventName,
                    data: payload,
                },
            };
            void (sink ?? bus).next(event);
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
