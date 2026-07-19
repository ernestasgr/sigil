import { describe, expect, it, vi } from 'vitest';

import { createQuitCoordinator } from './quit-coordinator.js';

function deferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
} {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

describe('quit coordinator', () => {
    it('prevents the first quit synchronously before starting cleanup', () => {
        const order: string[] = [];
        const preventDefault = vi.fn(() => {
            order.push('prevent');
        });
        const terminate = vi.fn(() => {
            order.push('terminate');
            return new Promise<number>(() => undefined);
        });
        const coordinator = createQuitCoordinator({
            getEngine: () => ({ terminate }),
            destroyTray: () => {
                order.push('destroy-tray');
            },
            requestQuit: () => {
                order.push('quit');
            },
        });

        const shutdown = coordinator.beforeQuit({ preventDefault });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(order).toEqual(['prevent', 'destroy-tray', 'terminate']);
        expect(shutdown).toBeInstanceOf(Promise);
    });

    it('coalesces re-entered quit events onto one shutdown promise', async () => {
        const termination = deferred<number>();
        const firstEvent = { preventDefault: vi.fn() };
        const secondEvent = { preventDefault: vi.fn() };
        const destroyTray = vi.fn();
        const terminate = vi.fn(() => termination.promise);
        const requestQuit = vi.fn();
        const coordinator = createQuitCoordinator({
            getEngine: () => ({ terminate }),
            destroyTray,
            requestQuit,
        });

        const firstShutdown = coordinator.beforeQuit(firstEvent);
        const secondShutdown = coordinator.beforeQuit(secondEvent);

        expect(secondShutdown).toBe(firstShutdown);
        expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
        expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
        expect(destroyTray).toHaveBeenCalledOnce();
        expect(terminate).toHaveBeenCalledOnce();
        expect(requestQuit).not.toHaveBeenCalled();

        termination.resolve(0);
        await firstShutdown;

        expect(requestQuit).toHaveBeenCalledOnce();
    });

    it('permits the final quit event without restarting cleanup', async () => {
        const termination = deferred<number>();
        const initialEvent = { preventDefault: vi.fn() };
        const finalEvent = { preventDefault: vi.fn() };
        const destroyTray = vi.fn();
        const terminate = vi.fn(() => termination.promise);
        const requestQuit = vi.fn();
        const coordinator = createQuitCoordinator({
            getEngine: () => ({ terminate }),
            destroyTray,
            requestQuit,
        });

        const shutdown = coordinator.beforeQuit(initialEvent);
        termination.resolve(0);
        await shutdown;

        await coordinator.beforeQuit(finalEvent);

        expect(finalEvent.preventDefault).not.toHaveBeenCalled();
        expect(destroyTray).toHaveBeenCalledOnce();
        expect(terminate).toHaveBeenCalledOnce();
        expect(requestQuit).toHaveBeenCalledOnce();
    });

    it('requests the final quit after Engine termination fails', async () => {
        const failure = new Error('engine shutdown failed');
        const terminate = vi.fn(async () => {
            throw failure;
        });
        const onFailure = vi.fn();
        const requestQuit = vi.fn();
        const coordinator = createQuitCoordinator({
            getEngine: () => ({ terminate }),
            destroyTray: vi.fn(),
            requestQuit,
            onFailure,
        });

        await coordinator.beforeQuit({ preventDefault: vi.fn() });

        expect(requestQuit).toHaveBeenCalledOnce();
        expect(onFailure).toHaveBeenCalledWith('engine', failure);
    });

    it('quits cleanly when no Engine is available', async () => {
        const preventDefault = vi.fn();
        const destroyTray = vi.fn();
        const terminate = vi.fn();
        const requestQuit = vi.fn();
        const coordinator = createQuitCoordinator({
            getEngine: () => null,
            destroyTray,
            requestQuit,
        });

        await coordinator.beforeQuit({ preventDefault });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(destroyTray).toHaveBeenCalledOnce();
        expect(terminate).not.toHaveBeenCalled();
        expect(requestQuit).toHaveBeenCalledOnce();
    });

    it('waits for a fast Engine termination to settle before requesting quit', async () => {
        const requestQuit = vi.fn();
        const coordinator = createQuitCoordinator({
            getEngine: () => ({ terminate: () => Promise.resolve(0) }),
            destroyTray: vi.fn(),
            requestQuit,
        });

        const shutdown = coordinator.beforeQuit({ preventDefault: vi.fn() });

        expect(requestQuit).not.toHaveBeenCalled();
        await shutdown;
        expect(requestQuit).toHaveBeenCalledOnce();
    });
});
