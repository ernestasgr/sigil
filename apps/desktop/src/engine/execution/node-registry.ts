import type { NodeType } from '@sigil/contracts/workflow';
import { Option } from 'effect';

import type { NodeHandler } from '../node-handlers/types.js';

export interface NodeHandlerRegistry {
    readonly register: (type: string, handler: NodeHandler) => void;
    readonly unregister: (type: string) => boolean;
    readonly get: (type: string) => Option.Option<NodeHandler>;
    readonly has: (type: string) => boolean;
}

export function createNodeHandlerRegistry(
    builtinHandlers: Readonly<Record<NodeType, NodeHandler>>,
): NodeHandlerRegistry {
    const handlers = new Map<string, NodeHandler>();
    const builtinTypes = new Set<string>();
    for (const [type, handler] of Object.entries(builtinHandlers)) {
        handlers.set(type, handler);
        builtinTypes.add(type);
    }
    return {
        register: (type, handler) => {
            handlers.set(type, handler);
        },
        unregister: (type) => {
            if (builtinTypes.has(type)) return false;
            return handlers.delete(type);
        },
        get: (type) => {
            const handler = handlers.get(type);
            return handler ? Option.some(handler) : Option.none();
        },
        has: (type) => handlers.has(type),
    };
}
