import vm from 'node:vm';

export type RpcOk = { readonly ok: true; readonly value?: unknown };
export type RpcError = { readonly ok: false; readonly error: string };
export type RpcResult = RpcOk | RpcError;

export interface PluginSandboxRpc {
    readonly eventEmit: (eventName: string, payload: unknown) => Promise<RpcResult>;
    readonly stateGet: (key: string) => Promise<RpcResult>;
    readonly stateSet: (key: string, value: unknown) => Promise<RpcResult>;
    readonly log: (message: string) => Promise<RpcResult>;
}

export interface PluginSandbox {
    readonly run: (code: string) => void;
    readonly global: Readonly<Record<string, unknown>>;
}

export function createPluginSandbox(rpc: PluginSandboxRpc): PluginSandbox {
    const sandbox: Record<string, unknown> = {
        event: {
            emit: (eventName: string, payload: unknown) => rpc.eventEmit(eventName, payload),
        },
        state: {
            get: (key: string) => rpc.stateGet(key),
            set: (key: string, value: unknown) => rpc.stateSet(key, value),
        },
        log: (message: string) => rpc.log(message),
        JSON,
        Math,
        Date,
        Promise,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Map,
        Set,
        Symbol,
        Error,
        RegExp,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
    };

    const context = vm.createContext(sandbox);

    return {
        run: (code) => {
            vm.runInContext(code, context, { timeout: 5000 });
        },
        global: sandbox,
    };
}
