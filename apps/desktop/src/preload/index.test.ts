import { describe, expect, it, vi } from 'vitest';

const exposeElectronTRPC = vi.hoisted(() => vi.fn());

vi.mock('electron-trpc/main', () => ({
    exposeElectronTRPC,
}));

await import('./index.js');

describe('preload bridge', () => {
    it('exposes only electron-trpc to the isolated renderer', () => {
        expect(exposeElectronTRPC).toHaveBeenCalledOnce();
    });
});
