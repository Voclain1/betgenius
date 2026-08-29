/**
 * Derives the maskable PWA icons in public/icons/ from the real brand mark.
 *
 * This script used to DRAW a placeholder — a programmatic rising chevron built
 * from signed-distance functions — because there was no brand asset yet. There
 * is one now: the BetGenius brand pack ships android-chrome-192/512,
 * apple-touch-icon, the favicon PNGs and favicon.ico as finished artwork, and
 * those are checked in verbatim. Nothing here regenerates them; overwriting
 * supplied artwork with something approximated from it would be a downgrade.
 *
 * What the pack does NOT ship is a maskable variant, and the manifest needs
 * one: Android crops a maskable icon to its own shape (circle, squircle,
 * teardrop) and only the centre 80% — the "safe zone" — is guaranteed to
 * survive. Play Store packaging for the TWA reads the 512px maskable icon out
 * of the manifest and refuses a manifest without it, so dropping it is not an
 * option either.
 *
 * The supplied 512px mark cannot be used as-is for that. Its artwork sits
 * off-centre in the square — roughly x 35%-85%, y 15%-66% — so a circular crop
 * would clip its right edge and leave it visibly high and to the right. So this
 * script does one narrow job: read public/icons/icon-512.png, find the bounding
 * box of the mark against its flat ground, and re-composite it centred and
 * scaled to fit the safe zone on the same ground colour.
 *
 * That makes the maskable icons a pure function of the checked-in source
 * artwork — re-running after the brand pack is updated is the whole update
 * path. Like before, the output is committed: the build must not run this.
 *
 * Run: npx tsx scripts/generate-pwa-icons.ts
 */
export {};

import { deflateSync, inflateSync } from "zlib";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

type RGB = [number, number, number];

/** Fraction of the canvas the mark is allowed to occupy in a maskable icon. */
const SAFE_ZONE = 0.8;

/** How far a pixel must differ from the corner colour to count as artwork. */
const GROUND_TOLERANCE = 24;

type Image = { width: number; height: number; pixels: Uint8Array /* RGBA */ };

// ---------------------------------------------------------------------------
// PNG decode
// ---------------------------------------------------------------------------

/**
 * Minimal PNG reader — 8-bit, non-interlaced, truecolour with or without
 * alpha, which is what the brand pack ships. Anything else throws rather than
 * silently producing wrong pixels.
 */
function decodePng(buf: Buffer): Image {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let pos = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    // A chunk claiming to run past the end means a truncated file. Say so:
    // silently decoding the prefix is how half an image reaches production.
    if (pos + 12 + len > buf.length) throw new Error(`truncated PNG: chunk ${type} runs past end of file`);
    if (type === "IHDR") ihdr = buf.subarray(pos + 8, pos + 8 + len);
    else if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
    if (type === "IEND") break;
  }
  if (!ihdr) throw new Error("PNG has no IHDR");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colourType = ihdr[9];
  const interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType}, interlace ${interlace})`);
  }

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));

  // Undo the per-scanline filters. Each line's filter type byte precedes it,
  // and filters 2-4 reference the line above, so this has to run in order.
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(line, 0, src, src + stride);
    src += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 1: line[i] = (line[i] + a) & 0xff; break;
        case 2: line[i] = (line[i] + b) & 0xff; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: break; // 0 = None
      }
    }
  }

  // Normalise to RGBA so everything downstream has one shape to handle.
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = out[i * channels];
    pixels[i * 4 + 1] = out[i * channels + 1];
    pixels[i * 4 + 2] = out[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? out[i * channels + 3] : 255;
  }
  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// PNG encode
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encodePng(image: Image): Buffer {
  const { width, height, pixels } = image;
  // Filter byte 0 (None) per scanline. These are flat-ground images with one
  // mark on them; a smarter filter buys nothing measurable.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }

  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * The tightest box containing everything that is not the flat ground colour.
 *
 * The ground is read from the top-left pixel rather than hardcoded, so a brand
 * pack that changes its icon background keeps working. Transparent pixels count
 * as ground too — the icon PNGs are opaque, but the standalone mark is not.
 */
function markBounds(image: Image, ground: RGB): Bounds {
  const { width, height, pixels } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 16) continue;
      const delta =
        Math.abs(pixels[i] - ground[0]) + Math.abs(pixels[i + 1] - ground[1]) + Math.abs(pixels[i + 2] - ground[2]);
      if (delta <= GROUND_TOLERANCE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("no artwork found: the source icon is a flat colour");
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Renders the mark centred on a `size` square of `ground`, scaled so its longer
 * side fills `SAFE_ZONE` of the canvas.
 *
 * Sampling is a box filter over the source rectangle each destination pixel
 * maps to. That is the right filter for downscaling by a large factor (512 to
 * 192 here), where a point sample would alias the mark's thin strokes into
 * broken pixels. Source pixels are composited onto the ground first, so a
 * partly-transparent source never darkens the result at the edges.
 */
function composite(source: Image, bounds: Bounds, size: number, ground: RGB): Image {
  const target = Math.round(size * SAFE_ZONE);
  const scale = target / Math.max(bounds.width, bounds.height);
  const drawW = bounds.width * scale;
  const drawH = bounds.height * scale;
  const originX = (size - drawW) / 2;
  const originY = (size - drawH) / 2;

  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = ground[0];
    pixels[i * 4 + 1] = ground[1];
    pixels[i * 4 + 2] = ground[2];
    pixels[i * 4 + 3] = 255;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The source rectangle this destination pixel covers, in source space.
      const sx0 = bounds.x + (x - originX) / scale;
      const sy0 = bounds.y + (y - originY) / scale;
      const x0 = Math.max(bounds.x, Math.floor(sx0));
      const y0 = Math.max(bounds.y, Math.floor(sy0));
      const x1 = Math.min(bounds.x + bounds.width, Math.ceil(sx0 + 1 / scale));
      const y1 = Math.min(bounds.y + bounds.height, Math.ceil(sy0 + 1 / scale));
      if (x1 <= x0 || y1 <= y0) continue;

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * source.width + sx) * 4;
          const a = source.pixels[i + 3] / 255;
          r += source.pixels[i] * a + ground[0] * (1 - a);
          g += source.pixels[i + 1] * a + ground[1] * (1 - a);
          b += source.pixels[i + 2] * a + ground[2] * (1 - a);
          n++;
        }
      }
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
    }
  }
  return { width: size, height: size, pixels };
}

// ---------------------------------------------------------------------------

const iconsDir = join(process.cwd(), "public", "icons");
const source = decodePng(readFileSync(join(iconsDir, "icon-512.png")));
if (source.width !== 512 || source.height !== 512) {
  throw new Error(`expected a 512x512 source, got ${source.width}x${source.height}`);
}

// Ground colour taken from the source's own corner — the brand pack's dark
// #07111f today, whatever it becomes tomorrow.
const ground: RGB = [source.pixels[0], source.pixels[1], source.pixels[2]];
const bounds = markBounds(source, ground);

const written: string[] = [];
for (const size of [192, 512]) {
  const name = `icon-maskable-${size}.png`;
  writeFileSync(join(iconsDir, name), encodePng(composite(source, bounds, size, ground)));
  written.push(name);
}

const hex = `#${ground.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
console.log(`Source: icon-512.png, ground ${hex}, mark ${bounds.width}x${bounds.height} at (${bounds.x}, ${bounds.y})`);
console.log(`Wrote ${written.length} maskable icons to public/icons: ${written.join(", ")}`);
