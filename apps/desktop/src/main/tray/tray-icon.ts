import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: Readonly<Uint32Array> = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Readonly<Buffer>): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Readonly<Buffer>): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function ihdr(width: number, height: number): Buffer {
    const data = Buffer.alloc(13);
    data.writeUInt32BE(width, 0);
    data.writeUInt32BE(height, 4);
    data[8] = 8;
    data[9] = 6;
    data[10] = 0;
    data[11] = 0;
    data[12] = 0;
    return chunk('IHDR', data);
}

function idat(width: number, height: number, r: number, g: number, b: number, a: number): Buffer {
    const rowLen = 1 + width * 4;
    const raw = Buffer.alloc(rowLen * height);
    for (let y = 0; y < height; y++) {
        raw[y * rowLen] = 0;
        for (let x = 0; x < width; x++) {
            const o = y * rowLen + 1 + x * 4;
            raw[o] = r;
            raw[o + 1] = g;
            raw[o + 2] = b;
            raw[o + 3] = a;
        }
    }
    return chunk('IDAT', deflateSync(raw));
}

function iend(): Buffer {
    return chunk('IEND', Buffer.alloc(0));
}

export function solidColorPng(
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number,
): Buffer {
    return Buffer.concat([
        PNG_SIGNATURE,
        ihdr(width, height),
        idat(width, height, r, g, b, a),
        iend(),
    ]);
}

export function solidColorPngDataUrl(
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number,
): string {
    return `data:image/png;base64,${solidColorPng(width, height, r, g, b, a).toString('base64')}`;
}
