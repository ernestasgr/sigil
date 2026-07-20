import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RendererCommandContracts, type RendererResponse } from '../shared/command-contracts.js';
import { ipcHandle, ipcHandleCommand } from './ipc/ipc-handle.js';

const mockHandle = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
    ipcMain: {
        handle: mockHandle,
    },
}));

describe('ipcHandle', () => {
    it('registers an ipcMain.handle with the given channel', () => {
        ipcHandle('test:noop', z.undefined(), async () => 'ok');

        expect(mockHandle).toHaveBeenCalledWith('test:noop', expect.any(Function));
    });

    it('passes valid no-arg invocation through to the handler', async () => {
        const handler = vi.fn().mockResolvedValue('done');
        ipcHandle('test:no-arg', z.undefined(), handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({}, ...([] as unknown[]));

        expect(handler).toHaveBeenCalledWith(undefined);
        expect(result).toBe('done');
    });

    it('passes valid single-arg invocation through to the handler', async () => {
        const handler = vi.fn().mockResolvedValue(42);
        const schema = z.string().min(1);
        ipcHandle('test:single-arg', schema, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({}, 'hello');

        expect(handler).toHaveBeenCalledWith('hello');
        expect(result).toBe(42);
    });

    it('passes valid tuple-arg invocation through to the handler', async () => {
        const handler = vi.fn().mockResolvedValue('ok');
        const schema = z.tuple([z.string(), z.number()]);
        ipcHandle('test:tuple-arg', schema, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({}, 'alpha', 7);

        expect(handler).toHaveBeenCalledWith(['alpha', 7]);
        expect(result).toBe('ok');
    });

    it('rejects the invocation when the argument is invalid', async () => {
        const handler = vi.fn();
        const schema = z.string().min(1);
        ipcHandle('test:reject', schema, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];

        let err: unknown;
        try {
            await wrapped({}, 123);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Invalid arguments for test:reject');
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects the invocation when a tuple element is invalid', async () => {
        const handler = vi.fn();
        const schema = z.tuple([z.string(), z.number()]);
        ipcHandle('test:tuple-reject', schema, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];

        let err: unknown;
        try {
            await wrapped({}, 'hello', 'not-a-number');
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Invalid arguments for test:tuple-reject');
        expect(handler).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by the handler', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('handler error'));
        ipcHandle('test:handler-error', z.undefined(), handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];

        await expect(wrapped({})).rejects.toThrow('handler error');
    });

    it('passes valid single-element tuple invocation through to the handler', async () => {
        const handler = vi.fn().mockResolvedValue('ok');
        const schema = z.tuple([z.string()]);
        ipcHandle('test:single-tuple', schema, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({}, 'hello');

        expect(handler).toHaveBeenCalledWith(['hello']);
        expect(result).toBe('ok');
    });

    it('handles handlers with no arguments when no args are passed from ipcMain', async () => {
        const handler = vi.fn().mockResolvedValue('noop');
        ipcHandle('test:empty', z.undefined(), handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({});

        expect(handler).toHaveBeenCalledWith(undefined);
        expect(result).toBe('noop');
    });

    it('registers a renderer command with contract-derived request and response validation', async () => {
        const handler = vi.fn(
            async (): Promise<RendererResponse<'fireTestEvent'>> => ({
                ok: false,
                error: 'execution failed',
            }),
        );
        ipcHandleCommand<'fireTestEvent'>(RendererCommandContracts.fireTestEvent, handler);

        const [, wrapped] = mockHandle.mock.lastCall as [string, (...args: unknown[]) => unknown];
        const result = await wrapped({});

        expect(handler).toHaveBeenCalledWith(undefined);
        expect(result).toEqual({ ok: false, error: 'execution failed' });
    });
});
