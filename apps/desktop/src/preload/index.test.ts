import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: readonly unknown[]) => void;
type PushMethod = 'onEngineLog' | 'onWorkflowsList' | 'onBusEvent';
type PushAPI = Record<PushMethod, (handler: (value: unknown) => void) => () => void>;
const listeners = new Map<string, Listener>();
const exposed = { current: undefined as PushAPI | undefined };

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: (_name: string, api: unknown) => {
            exposed.current = api as PushAPI;
        },
    },
    ipcRenderer: {
        invoke: vi.fn(),
        on: (channel: string, listener: Listener) => {
            listeners.set(channel, listener);
        },
        off: (channel: string) => {
            listeners.delete(channel);
        },
    },
}));

const { RendererChannel } = await import('../shared/ipc-channels.js');
await import('./index.js');

describe('preload push-channel validation', () => {
    beforeEach(() => {
        listeners.clear();
        vi.restoreAllMocks();
    });

    it.each([
        ['onEngineLog', RendererChannel.EngineLog, 'valid log', 42],
        ['onWorkflowsList', RendererChannel.WorkflowsList, [], { invalid: true }],
        ['onBusEvent', RendererChannel.BusEvent, { name: 'x', payload: null }, { name: 1 }],
    ] as const)(
        '%s forwards valid payloads and drops malformed payloads',
        (method, channel, valid, invalid) => {
            const handler = vi.fn();
            exposed.current?.[method](handler);
            listeners.get(channel)?.({}, valid);
            expect(handler).toHaveBeenCalledWith(valid);
            handler.mockClear();
            const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            listeners.get(channel)?.({}, invalid);
            expect(handler).not.toHaveBeenCalled();
            expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('invalid'), invalid);
        },
    );
});
