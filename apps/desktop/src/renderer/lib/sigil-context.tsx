import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { SigilAdapter } from './sigil-adapter.js';
import { createSigilAdapter } from './sigil-adapter.js';

const SigilContext = createContext<SigilAdapter | null>(null);

export function SigilProvider({ children }: { readonly children: ReactNode }): ReactElement {
    const adapter = createSigilAdapter();

    return <SigilContext.Provider value={adapter}>{children}</SigilContext.Provider>;
}

export function useSigil(): SigilAdapter {
    const adapter = useContext(SigilContext);
    if (!adapter) {
        throw new Error('useSigil must be used within a SigilProvider');
    }
    return adapter;
}
