import type { SigilRendererAPI } from '../preload/index.js';

declare global {
    interface Window {
        sigil: SigilRendererAPI;
    }
}

export {};
