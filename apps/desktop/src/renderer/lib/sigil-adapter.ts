import type { SigilRendererAPI } from '../../preload/index.js';

export type SigilAdapter = SigilRendererAPI;

export function createSigilAdapter(): SigilAdapter {
    return window.sigil;
}
