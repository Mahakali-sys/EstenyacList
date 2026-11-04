const zlib = require("zlib");
const fs = require("fs");

const W = 512, H = 512;
const bg = [76, 29, 149]; // violet-800
const fg = [196, 181, 253]; // violet-200

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  const row = y * (W * 4 + 1);
  raw[row] = 0; // filter none
  for (let x = 0; x < W; x++) {
    const o = row + 1 + x * 4;
    const r = Math.hypot(x - W / 2, y - H / 2);
    // rounded-rect background
    const cx = x < 44 || x > W - 45 || y < 44 || y > H - 45 ? -1 : 1;
    const inside = cx > 0;
    // draw a stylized "E" bar mark: three bars + spine
    const bar = x > 140 && x < 372 && ((y > 120 && y < 172) || (y > 218 && y < 270) || (y > 316 && y < 368) || (y > 316 && y < 368));
    const spine = x > 140 && x < 172 && y > 120 && y < 368;
    const isE = (bar || spine);
    if (inside && isE) {
      raw[o] = fg[0]; raw[o + 1] = fg[1]; raw[o + 2] = fg[2]; raw[o + 3] = 255;
    } else if (inside) {
      raw[o] = bg[0]; raw[o + 1] = bg[1]; raw[o + 2] = bg[2]; raw[o + 3] = 255;
    } else {
      raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 0;
    }
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(process.argv[2] || "app-icon.png", png);
console.log("wrote", process.argv[2]);