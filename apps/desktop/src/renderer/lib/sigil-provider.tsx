import type { ReactElement, ReactNode } from 'react';

import { createSigilAdapter } from './sigil-adapter.js';
import { SigilContext } from './sigil-context.js';

export function SigilProvider({ children }: { readonly children: ReactNode }): ReactElement {
    const adapter = createSigilAdapter();

    return <SigilContext.Provider value={adapter}>{children}</SigilContext.Provider>;
}
