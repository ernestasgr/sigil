export type TrayMenuItem =
    | { readonly kind: 'enable-workflows' }
    | { readonly kind: 'disable-workflows' }
    | { readonly kind: 'open-app' }
    | { readonly kind: 'separator' }
    | { readonly kind: 'quit' };

export interface TrayMenu {
    readonly workflowsActive: boolean;
    readonly items: readonly TrayMenuItem[];
}

export function buildTrayMenu(workflowsActive: boolean): TrayMenu {
    const toggle: TrayMenuItem = workflowsActive
        ? { kind: 'disable-workflows' }
        : { kind: 'enable-workflows' };

    return {
        workflowsActive,
        items: [
            toggle,
            { kind: 'separator' },
            { kind: 'open-app' },
            { kind: 'separator' },
            { kind: 'quit' },
        ],
    };
}
