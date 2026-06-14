/**
 * Generates the source Orbit app icon (1024×1024 PNG) with no dependencies.
 * The mark: a soft indigo→violet field with a thin orbital ring, a bright core
 * and a single planet on the ring — original artwork for the temporary brand.
 *
 * Usage: node scripts/generate-icon.mjs <out.png>
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 1024;
const H = 1024;

// --- tiny PNG encoder ---------------------------------------------------------
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing ------------------------------------------------------------------
const buf = Buffer.alloc(W * H * 4);
const cx = W / 2;
const cy = H / 2;
const R = W * 0.34; // ring radius
const ringHalf = W * 0.018; // half stroke
const coreR = W * 0.115;
const planetR = W * 0.058;
const planetAngle = -Math.PI / 4;
const px = cx + R * Math.cos(planetAngle);
const py = cy + R * Math.sin(planetAngle);

const lerp = (a, b, t) => a + (b - a) * t;
function setPx(i, r, g, b, a) {
  // alpha-over compositing onto existing pixel
  const ba = buf[i + 3] / 255;
  const sa = a / 255;
  const outA = sa + ba * (1 - sa);
  if (outA === 0) return;
  buf[i] = Math.round((r * sa + buf[i] * ba * (1 - sa)) / outA);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * ba * (1 - sa)) / outA);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * ba * (1 - sa)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}
// coverage in [0,1] for soft edges
const cover = (signed) => Math.max(0, Math.min(1, 0.5 - signed));

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    // background gradient (indigo top → violet bottom)
    const t = y / H;
    const bgR = Math.round(lerp(109, 79, t));
    const bgG = Math.round(lerp(94, 70, t));
    const bgB = Math.round(lerp(246, 229, t));
    buf[i] = bgR;
    buf[i + 1] = bgG;
    buf[i + 2] = bgB;
    buf[i + 3] = 255;

    const dCenter = Math.hypot(x - cx, y - cy);

    // orbital ring (subtle, light)
    const ringSigned = Math.abs(dCenter - R) - ringHalf;
    const ringCov = cover(ringSigned);
    if (ringCov > 0) setPx(i, 226, 232, 255, Math.round(200 * ringCov));

    // core (bright white with a faint glow)
    const coreCov = cover(dCenter - coreR);
    if (coreCov > 0) setPx(i, 255, 255, 255, Math.round(255 * coreCov));
    const glowCov = cover(dCenter - coreR * 1.7);
    if (glowCov > 0 && coreCov === 0) setPx(i, 255, 255, 255, Math.round(40 * glowCov));

    // planet on the ring
    const dPlanet = Math.hypot(x - px, y - py);
    const planetCov = cover(dPlanet - planetR);
    if (planetCov > 0) setPx(i, 199, 210, 254, Math.round(255 * planetCov));
  }
}

const out = process.argv[2] ?? 'app-icon.png';
writeFileSync(out, encodePng(buf, W, H));
console.error(`wrote ${out} (${W}x${H})`);
