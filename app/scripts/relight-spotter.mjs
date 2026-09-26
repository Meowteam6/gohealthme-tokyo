// Night Shift art pipeline (docs/DESIGN.md, "SPOTTER on a night field").
//
// The painted SPOTTER cutouts in public/spotter/ were matted against a white
// backdrop, so on the indigo field their edges glow and their lighting reads as
// daylight. This re-mattes them for dark fields (edge colour decontamination, a
// one-pixel tighter matte) and relights each toward one warm key (the moon) with
// a cool fill, then trims to the visible otter so layout sizes by the otter and
// not by empty canvas. It also rasterises the brand mark (app/icon.svg) into the
// apple-icon, the 512px mark and the favicon.
//
// Reads public/spotter/spotter-<pose>.webp and app/icon.svg. Writes only
// public/spotter/night/<pose>.webp, public/brand/ (mark.svg, mark-512.png and
// og-sleep.png, a PNG of the sleep pose for the share card, which cannot read
// WebP), app/apple-icon.png and app/favicon.ico. The originals are never
// touched.
//
//   node scripts/relight-spotter.mjs            # every pose and the mark
//   node scripts/relight-spotter.mjs sleep wave # just those poses
//
// sharp comes in with next (next/image depends on it), so there is nothing
// extra to install.

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(APP, "package.json"));
const sharp = require("sharp");

const SRC = join(APP, "public/spotter");
const OUT = join(APP, "public/spotter/night");

// The only poses allowed on a night field (docs/DESIGN.md staging table).
// lightX/lightY put the warm key in pose-relative coordinates.
const POSES = {
  sleep: { lightX: 0.85, lightY: 0.0 },
  wearable: { lightX: 0.9, lightY: 0.1 },
  wave: { lightX: 0.85, lightY: 0.05 },
  thumbsup: { lightX: 0.85, lightY: 0.05 },
  meditate: { lightX: 0.5, lightY: -0.1 },
  detective: { lightX: 0.85, lightY: 0.05 },
  facepalm: { lightX: 0.85, lightY: 0.05 },
  thinking: { lightX: 0.85, lightY: 0.05 },
};

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / d;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function erode(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1e9;
      for (let k = -r; k <= r; k++) m = Math.min(m, src[y * w + Math.min(w - 1, Math.max(0, x + k))]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1e9;
      for (let k = -r; k <= r; k++) m = Math.min(m, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

async function relight(name, opts) {
  const {
    lightX = 0.8,
    lightY = 0.15,
    key = [1.04, 1.0, 0.94],
    fill = [0.74, 0.8, 1.0],
    dim = 0.96,
    erodePx = 1,
  } = opts;
  const { data, info } = await sharp(join(SRC, `spotter-${name}.webp`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const A = new Float32Array(n);
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = data[i * 4 + 3] / 255;
    R[i] = data[i * 4];
    G[i] = data[i * 4 + 1];
    B[i] = data[i * 4 + 2];
  }

  // Interior: fully opaque, pulled 3px in from the silhouette.
  const solid = new Float32Array(n);
  for (let i = 0; i < n; i++) solid[i] = A[i] > 0.98 ? 1 : 0;
  const interior = erode(solid, w, h, 3);

  // Bleed interior colour outward so edge pixels carry fur colour, not the old
  // white backdrop.
  let wR = new Float32Array(n);
  let wG = new Float32Array(n);
  let wB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    wR[i] = R[i] * interior[i];
    wG[i] = G[i] * interior[i];
    wB[i] = B[i] * interior[i];
  }
  let m = interior;
  for (const r of [3, 3, 6]) {
    wR = boxBlur(wR, w, h, r);
    wG = boxBlur(wG, w, h, r);
    wB = boxBlur(wB, w, h, r);
    m = boxBlur(m, w, h, r);
  }

  // Tighten the matte: erode alpha, then re-soften by one pixel.
  let a2 = erodePx > 0 ? erode(A, w, h, erodePx) : A;
  a2 = boxBlur(a2, w, h, 1);

  const out = Buffer.alloc(n * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = R[i];
      let g = G[i];
      let b = B[i];
      if (interior[i] < 1 && A[i] > 0 && m[i] > 0.02) {
        const br = wR[i] / m[i];
        const bg = wG[i] / m[i];
        const bb = wB[i] / m[i];
        // Closer to the edge takes more bled colour; keep some texture.
        const t = Math.min(1, (1 - A[i]) * 1.2 + 0.55);
        // Pull toward the bled colour only where the original is lighter
        // (white contamination).
        const lumO = 0.3 * r + 0.59 * g + 0.11 * b;
        const lumB = 0.3 * br + 0.59 * bg + 0.11 * bb;
        const k = lumO > lumB ? t : t * 0.4;
        r = r * (1 - k) + br * k;
        g = g * (1 - k) + bg * k;
        b = b * (1 - k) + bb * k;
      }
      // Relight: warm key toward (lightX, lightY), cool fill away from it.
      const dx = x / w - lightX;
      const dy = y / h - lightY;
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.1);
      const s = dist * dist * (3 - 2 * dist);
      const fr = key[0] * (1 - s) + fill[0] * s;
      const fg = key[1] * (1 - s) + fill[1] * s;
      const fb = key[2] * (1 - s) + fill[2] * s;
      out[i * 4] = Math.max(0, Math.min(255, r * fr * dim));
      out[i * 4 + 1] = Math.max(0, Math.min(255, g * fg * dim));
      out[i * 4 + 2] = Math.max(0, Math.min(255, b * fb * dim));
      out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(Math.min(A[i], a2[i]) * 255)));
    }
  }

  const file = join(OUT, `${name}.webp`);
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 })
    .toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`night/${name}.webp ${meta.width}x${meta.height}`);
}

/** A PNG-payload .ico (supported by every current browser). */
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

async function mark() {
  const svg = join(APP, "app/icon.svg");
  const raster = (size) =>
    sharp(svg, { density: Math.ceil(((72 * size) / 40) * 2) })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
  await mkdir(join(APP, "public/brand"), { recursive: true });
  await copyFile(svg, join(APP, "public/brand/mark.svg"));
  await writeFile(join(APP, "public/brand/mark-512.png"), await raster(512));
  await sharp(join(OUT, "sleep.webp"))
    .resize({ width: 560 })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(join(APP, "public/brand/og-sleep.png"));
  await writeFile(join(APP, "app/apple-icon.png"), await raster(180));
  const ico = icoFromPngs([
    { size: 16, buf: await raster(16) },
    { size: 32, buf: await raster(32) },
    { size: 48, buf: await raster(48) },
  ]);
  await writeFile(join(APP, "app/favicon.ico"), ico);
  console.log("brand/{mark.svg,mark-512.png,og-sleep.png}, app/apple-icon.png, app/favicon.ico");
}

await mkdir(OUT, { recursive: true });
const picked = process.argv.slice(2);
for (const [name, opts] of Object.entries(POSES)) {
  if (picked.length === 0 || picked.includes(name)) await relight(name, opts);
}
if (picked.length === 0) await mark();
