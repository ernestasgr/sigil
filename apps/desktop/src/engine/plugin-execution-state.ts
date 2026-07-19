export type PluginExecutionState =
    | { readonly kind: 'running' }
    | { readonly kind: 'cancellation-requested'; readonly reason: string }
    | { readonly kind: 'settled' };

export type PluginExecutionEvent =
    | { readonly kind: 'cancel-requested'; readonly reason: string }
    | { readonly kind: 'cancel-acknowledged' }
    | { readonly kind: 'completed' }
    | { readonly kind: 'failed' };

export interface PluginExecutionTransition {
    readonly accepted: boolean;
    readonly state: PluginExecutionState;
}

export function createPluginExecutionState(): PluginExecutionState {
    return { kind: 'running' };
}

export function transitionPluginExecution(
    state: PluginExecutionState,
    event: PluginExecutionEvent,
): PluginExecutionTransition {
    switch (state.kind) {
        case 'running':
            switch (event.kind) {
                case 'cancel-requested':
                    return {
                        accepted: true,
                        state: { kind: 'cancellation-requested', reason: event.reason },
                    };
                case 'cancel-acknowledged':
                    return { accepted: false, state };
                case 'completed':
                case 'failed':
                    return { accepted: true, state: { kind: 'settled' } };
                default:
                    return assertNever(event);
            }
        case 'cancellation-requested':
            switch (event.kind) {
                case 'cancel-requested':
                case 'completed':
                case 'failed':
                    return { accepted: false, state };
                case 'cancel-acknowledged':
                    return { accepted: true, state: { kind: 'settled' } };
                default:
                    return assertNever(event);
            }
        case 'settled':
            return { accepted: false, state };
        default:
            return assertNever(state);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled Plugin execution transition: ${JSON.stringify(value)}`);
}
