import { describe, expect, it } from 'vitest';

import { createPluginSandbox, type PluginSandboxRpc, type RpcResult } from './plugin-sandbox.js';

function captureRpc(): PluginSandboxRpc & {
    calls: { method: string; args: unknown[] }[];
} {
    const calls: { method: string; args: unknown[] }[] = [];
    const rpc: PluginSandboxRpc & { calls: typeof calls } = {
        eventEmit: (...args) => {
            calls.push({ method: 'event.emit', args });
            return Promise.resolve({ ok: true });
        },
        stateGet: (...args) => {
            calls.push({ method: 'state.get', args });
            return Promise.resolve({ ok: true, value: 'state-value' });
        },
        stateSet: (...args) => {
            calls.push({ method: 'state.set', args });
            return Promise.resolve({ ok: true });
        },
        log: (...args) => {
            calls.push({ method: 'log', args });
            return Promise.resolve({ ok: true });
        },
        calls,
    };
    return rpc;
}

describe('createPluginSandbox', () => {
    it('exposes event.emit, state.get, state.set, and log to plugin code', async () => {
        const rpc = captureRpc();
        const sandbox = createPluginSandbox(rpc);
        const code = `
            globalThis.__test = async function() {
                await event.emit('stub.ping', { message: 'hello' });
                await state.set('counter', 1);
                const v = await state.get('counter');
                await log('started');
                return v;
            };
        `;
        sandbox.run(code);
        const testFn = sandbox.global['__test'] as () => Promise<RpcResult>;
        const result = await testFn();
        expect(result).toEqual({ ok: true, value: 'state-value' });
        expect(rpc.calls.map((c: { method: string }) => c.method)).toEqual([
            'event.emit',
            'state.set',
            'state.get',
            'log',
        ]);
    });

    it('does not expose require', () => {
        const sandbox = createPluginSandbox(captureRpc());
        sandbox.run(`globalThis.__hasRequire = typeof require !== 'undefined';`);
        expect(sandbox.global.__hasRequire).toBe(false);
    });

    it('does not expose process', () => {
        const sandbox = createPluginSandbox(captureRpc());
        sandbox.run(`globalThis.__hasProcess = typeof process !== 'undefined';`);
        expect(sandbox.global.__hasProcess).toBe(false);
    });

    it('does not expose fs', () => {
        const sandbox = createPluginSandbox(captureRpc());
        sandbox.run(`globalThis.__hasFs = typeof fs !== 'undefined';`);
        expect(sandbox.global.__hasFs).toBe(false);
    });

    it('does not expose net', () => {
        const sandbox = createPluginSandbox(captureRpc());
        sandbox.run(`globalThis.__hasNet = typeof net !== 'undefined';`);
        expect(sandbox.global.__hasNet).toBe(false);
    });

    it('exposes safe globals like JSON, Math, Date, Promise', () => {
        const sandbox = createPluginSandbox(captureRpc());
        sandbox.run(`
            globalThis.__hasSafeGlobals =
                typeof JSON !== 'undefined' &&
                typeof Math !== 'undefined' &&
                typeof Date !== 'undefined' &&
                typeof Promise !== 'undefined';
        `);
        expect(sandbox.global.__hasSafeGlobals).toBe(true);
    });

    it('throws on syntax error in plugin code', () => {
        const sandbox = createPluginSandbox(captureRpc());
        expect(() => sandbox.run('this is not valid javascript')).toThrow();
    });

    it('captures errors thrown by plugin code', () => {
        const sandbox = createPluginSandbox(captureRpc());
        expect(() => sandbox.run(`throw new Error('plugin boom');`)).toThrow('plugin boom');
    });
});
