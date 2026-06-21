import { describe, expect, it } from 'vitest';

import { solidColorPng, solidColorPngDataUrl } from './tray-icon.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('solidColorPng', () => {
    it('produces a buffer with the PNG signature', () => {
        const png = solidColorPng(16, 16, 0xc9, 0xa2, 0x27, 0xff);

        expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});

describe('solidColorPngDataUrl', () => {
    it('produces a base64 PNG data url', () => {
        const url = solidColorPngDataUrl(16, 16, 0xc9, 0xa2, 0x27, 0xff);

        expect(url.startsWith('data:image/png;base64,')).toBe(true);
    });
});
