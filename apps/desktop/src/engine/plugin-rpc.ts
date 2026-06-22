export const PluginRpcKind = {
    EventEmit: 'plugin:event.emit',
    StateGet: 'plugin:state.get',
    StateSet: 'plugin:state.set',
    Log: 'plugin:log',
} as const;

export const PluginLifecycleKind = {
    Ready: 'plugin:ready',
    Error: 'plugin:error',
    Result: 'plugin:result',
} as const;

export type PluginRpcRequest =
    | {
          readonly kind: typeof PluginRpcKind.EventEmit;
          readonly requestId: string;
          readonly pluginId: string;
          readonly eventName: string;
          readonly payload: unknown;
      }
    | {
          readonly kind: typeof PluginRpcKind.StateGet;
          readonly requestId: string;
          readonly pluginId: string;
          readonly key: string;
      }
    | {
          readonly kind: typeof PluginRpcKind.StateSet;
          readonly requestId: string;
          readonly pluginId: string;
          readonly key: string;
          readonly value: unknown;
      }
    | {
          readonly kind: typeof PluginRpcKind.Log;
          readonly requestId: string;
          readonly pluginId: string;
          readonly message: string;
      };

export type PluginRpcResponse =
    | {
          readonly kind: typeof PluginLifecycleKind.Result;
          readonly requestId: string;
          readonly ok: true;
          readonly value: unknown;
      }
    | {
          readonly kind: typeof PluginLifecycleKind.Result;
          readonly requestId: string;
          readonly ok: false;
          readonly error: string;
      };

export type PluginWorkerReady = {
    readonly kind: typeof PluginLifecycleKind.Ready;
    readonly pluginId: string;
};

export type PluginWorkerError = {
    readonly kind: typeof PluginLifecycleKind.Error;
    readonly pluginId: string;
    readonly message: string;
};

export type PluginToEngineMessage = PluginRpcRequest | PluginWorkerReady | PluginWorkerError;
export type EngineToPluginMessage = PluginRpcResponse;
