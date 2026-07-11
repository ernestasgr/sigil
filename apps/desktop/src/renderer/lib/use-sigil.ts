import { useContext } from 'react';

import type { SigilAdapter } from './sigil-adapter.js';
import { SigilContext } from './sigil-context.js';

export function useSigil(): SigilAdapter {
    const adapter = useContext(SigilContext);
    if (!adapter) {
        throw new Error('useSigil must be used within a SigilProvider');
    }
    return adapter;
}
