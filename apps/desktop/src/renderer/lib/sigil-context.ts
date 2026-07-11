import { createContext } from 'react';

import type { SigilAdapter } from './sigil-adapter.js';

export const SigilContext = createContext<SigilAdapter | null>(null);
