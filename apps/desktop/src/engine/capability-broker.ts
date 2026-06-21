export type Capability =
    | 'filesystem.read'
    | 'filesystem.write'
    | 'network'
    | 'clipboard'
    | 'processes'
    | 'display'
    | 'keyboard.global'
    | 'microphone';

export type CapabilityRequest = {
    readonly pluginId: string;
    readonly capability: Capability;
};

export type CapabilityResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly error: { readonly kind: 'denied'; readonly capability: Capability };
      };

export interface CapabilityBroker {
    readonly request: (request: CapabilityRequest) => CapabilityResult;
}

export function createStubCapabilityBroker(): CapabilityBroker {
    return {
        request: () => ({ ok: true }),
    };
}
