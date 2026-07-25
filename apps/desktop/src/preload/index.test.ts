import { describe, expect, it, vi } from 'vitest';

const exposeElectronTRPC = vi.hoisted(() => vi.fn());
const contextBridge = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));

vi.mock('electron-trpc/main', () => ({
    exposeElectronTRPC,
}));
vi.mock('electron', () => ({
    contextBridge,
}));

await import('./index.js');

describe('preload bridge', () => {
    it('exposes only electron-trpc to the isolated renderer', () => {
        expect(exposeElectronTRPC).not.toHaveBeenCalled();
        process.emit('loaded' as never);
        expect(exposeElectronTRPC).toHaveBeenCalledOnce();
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    });
});
