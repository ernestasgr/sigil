import { describe, expect, it, vi } from 'vitest';

import type { NodeHandler } from './node-handlers/types.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { createFileWatcherManager } from './file-watcher-manager.js';
import { createNodeHandlerRegistry } from './node-registry.js';

describe('NodeHandlerRegistry', () => {
    it('pre-registers all builtin handlers', () => {
        const registry = createNodeHandlerRegistry(
            createBuiltinHandlers({ fileWatcherManager: createFileWatcherManager() }),
        );

        expect(registry.has('manual-trigger')).toBe(true);
        expect(registry.has('file-watcher')).toBe(true);
        expect(registry.has('if-else')).toBe(true);
        expect(registry.has('switch')).toBe(true);
        expect(registry.has('log')).toBe(true);
        expect(registry.has('delay')).toBe(true);
        expect(registry.has('notification')).toBe(true);
        expect(registry.has('file-manager')).toBe(true);
        expect(registry.has('state-get')).toBe(true);
        expect(registry.has('state-set')).toBe(true);
    });

    it('get returns the handler for a registered type', () => {
        const registry = createNodeHandlerRegistry(
            createBuiltinHandlers({ fileWatcherManager: createFileWatcherManager() }),
        );

        const handler = registry.get('log');
        expect(handler).toBeDefined();
        expect(typeof handler?.execute).toBe('function');
    });

    it('get returns undefined for an unregistered type', () => {
        const registry = createNodeHandlerRegistry(
            createBuiltinHandlers({ fileWatcherManager: createFileWatcherManager() }),
        );

        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('register adds a new handler', () => {
        const registry = createNodeHandlerRegistry(
            createBuiltinHandlers({ fileWatcherManager: createFileWatcherManager() }),
        );

        const customHandler: NodeHandler = {
            execute: vi.fn() as unknown as NodeHandler['execute'],
        };

        expect(registry.has('custom')).toBe(false);
        registry.register('custom', customHandler);
        expect(registry.has('custom')).toBe(true);
        expect(registry.get('custom')).toBe(customHandler);
    });

    it('register overwrites an existing handler', () => {
        const registry = createNodeHandlerRegistry(
            createBuiltinHandlers({ fileWatcherManager: createFileWatcherManager() }),
        );

        const original = registry.get('log');
        const replacement: NodeHandler = {
            execute: vi.fn() as unknown as NodeHandler['execute'],
        };

        registry.register('log', replacement);
        expect(registry.get('log')).toBe(replacement);
        expect(registry.get('log')).not.toBe(original);
    });
});
