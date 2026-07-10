import { describe, expect, it, vi } from 'vitest';
import { Option } from 'effect';

import type { NodeHandler } from './node-handlers/types.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { createNodeHandlerRegistry } from './node-registry.js';

function testHandlers() {
    return createBuiltinHandlers();
}

describe('NodeHandlerRegistry', () => {
    it('pre-registers all builtin handlers', () => {
        const registry = createNodeHandlerRegistry(testHandlers());

        expect(registry.has('manual-trigger')).toBe(true);
        expect(registry.has('if-else')).toBe(true);
        expect(registry.has('switch')).toBe(true);
        expect(registry.has('log')).toBe(true);
        expect(registry.has('delay')).toBe(true);
        expect(registry.has('notification')).toBe(true);
        expect(registry.has('state-get')).toBe(true);
        expect(registry.has('state-set')).toBe(true);
    });

    it('get returns Some for a registered type', () => {
        const registry = createNodeHandlerRegistry(testHandlers());

        const handler = registry.get('log');
        expect(Option.isSome(handler)).toBe(true);
        expect(typeof Option.getOrThrow(handler).execute).toBe('function');
    });

    it('get returns None for an unregistered type', () => {
        const registry = createNodeHandlerRegistry(testHandlers());

        expect(Option.isNone(registry.get('nonexistent'))).toBe(true);
    });

    it('register adds a new handler', () => {
        const registry = createNodeHandlerRegistry(testHandlers());

        const customHandler: NodeHandler = {
            execute: vi.fn() as unknown as NodeHandler['execute'],
        };

        expect(registry.has('custom')).toBe(false);
        registry.register('custom', customHandler);
        expect(registry.has('custom')).toBe(true);
        expect(Option.getOrThrow(registry.get('custom'))).toBe(customHandler);
    });

    it('register overwrites an existing handler', () => {
        const registry = createNodeHandlerRegistry(testHandlers());

        const original = Option.getOrThrow(registry.get('log'));
        const replacement: NodeHandler = {
            execute: vi.fn() as unknown as NodeHandler['execute'],
        };

        registry.register('log', replacement);
        expect(Option.getOrThrow(registry.get('log'))).toBe(replacement);
        expect(Option.getOrThrow(registry.get('log'))).not.toBe(original);
    });
});
