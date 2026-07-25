import { afterEach, describe, expect, it, vi } from 'vitest';

type SubscriptionObserver = {
    readonly onData: (value: unknown) => void;
    readonly onError: (error: unknown) => void;
};

const subscriptions = vi.hoisted(() => ({
    onEngineLog: { subscribe: vi.fn() },
    onWorkflowsList: { subscribe: vi.fn() },
    onBusEvent: { subscribe: vi.fn() },
}));

vi.mock('@trpc/client', () => ({
    createTRPCProxyClient: vi.fn(() => ({
        onEngineLog: subscriptions.onEngineLog,
        onWorkflowsList: subscriptions.onWorkflowsList,
        onBusEvent: subscriptions.onBusEvent,
    })),
}));

vi.mock('electron-trpc/renderer', () => ({
    ipcLink: vi.fn(() => ({})),
}));

const { createSigilAdapter } = await import('./sigil-adapter.js');

const subscriptionCases = [
    {
        name: 'onEngineLog' as const,
        invalid: 42,
        valid: 'engine log',
    },
    {
        name: 'onWorkflowsList' as const,
        invalid: [{ id: 42 }],
        valid: [
            {
                id: 'workflow-1',
                name: 'Workflow 1',
                enabled: false,
                activation: { kind: 'disabled' },
            },
        ],
    },
    {
        name: 'onBusEvent' as const,
        invalid: { name: 42, payload: {} },
        valid: { name: 'workflow.completed', payload: {} },
    },
] as const;

afterEach(() => {
    vi.clearAllMocks();
});

describe('SigilAdapter subscriptions', () => {
    for (const subscriptionCase of subscriptionCases) {
        it(`${subscriptionCase.name} reports invalid data and preserves valid data`, () => {
            let observer: SubscriptionObserver | undefined;
            const unsubscribe = vi.fn();
            subscriptions[subscriptionCase.name].subscribe.mockImplementation(
                (_input: unknown, nextObserver: SubscriptionObserver) => {
                    observer = nextObserver;
                    return { unsubscribe };
                },
            );

            const handler = vi.fn();
            const subscribe = createSigilAdapter()[subscriptionCase.name] as unknown as (
                next: (value: unknown) => void,
            ) => () => void;
            const stop = subscribe(handler);
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

            try {
                expect(observer).toBeDefined();
                observer?.onData(subscriptionCase.invalid);
                expect(handler).not.toHaveBeenCalled();
                expect(consoleError).toHaveBeenCalledWith(
                    `[renderer] ${subscriptionCase.name} subscription failed:`,
                    expect.anything(),
                );

                observer?.onData(subscriptionCase.valid);
                expect(handler).toHaveBeenCalledWith(subscriptionCase.valid);
            } finally {
                stop();
                consoleError.mockRestore();
            }

            expect(unsubscribe).toHaveBeenCalledOnce();
        });
    }
});
