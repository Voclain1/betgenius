/**
 * Generates the PWA icon set into public/icons/.
 *
 * Written as a generator rather than checked-in binaries so the icons stay
 * derivable from the brand palette in tailwind.config.ts — changing the green
 * there and re-running this is the whole update path. It is committed output,
 * though: the build must not depend on running this.
 *
 * No image library is used. PNG is a small enough format to emit directly
 * (zlib is in Node's stdlib), and adding a native image dependency to a Next
 * app for six static files is a worse trade than fifty lines of encoder.
 *
 * The mark is a rising chevron — the one shape that reads at 48px on a phone's
 * home screen, where a wordmark would not. Three variants are produced:
 *   - `any`      dark ground, green mark: matches the app's own dark UI.
 *   - `maskable` green ground, dark mark, drawn inside the 80% safe zone so
 *                Android can crop it to a circle/squircle without clipping.
 *   - `apple`    same as `any` but with no transparency anywhere, since iOS
 *                composites the touch icon onto white.
 *
 * Run: npx tsx scripts/generate-pwa-icons.ts
 */
export {};

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// From tailwind.config.ts — keep in step with the brand palette.
const GREEN: RGB = [0x00, 0xc8, 0x53];
const DARK: RGB = [0x0a, 0x0f, 0x14];

type RGB = [number, number, number];

class Canvas {
  readonly pixels: Uint8Array; // RGBA

  constructor(readonly size: number, background: RGB) {
    this.pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      this.pixels[i * 4] = background[0];
      this.pixels[i * 4 + 1] = background[1];
      this.pixels[i * 4 + 2] = background[2];
      this.pixels[i * 4 + 3] = 255;
    }
  }

  /** Alpha-blends one pixel — the only writer, so anti-aliasing is uniform. */
  blend(x: number, y: number, color: RGB, alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const a = Math.min(1, alpha);
    for (let c = 0; c < 3; c++) this.pixels[i + c] = Math.round(this.pixels[i + c] * (1 - a) + color[c] * a);
  }

  /**
   * Fills wherever `sdf(x, y)` is negative, feathering across the ±0.5px band
   * around the boundary. Every shape below is expressed as a signed-distance
   * function so they all get the same edge quality for free.
   */
  fill(sdf: (x: number, y: number) => number, color: RGB) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const d = sdf(x + 0.5, y + 0.5);
        this.blend(x, y, color, Math.min(1, Math.max(0, 0.5 - d)));
      }
    }
  }
}

/** Distance to a rounded rectangle centred at (cx, cy). */
const roundedRect = (cx: number, cy: number, halfW: number, halfH: number, r: number) => (x: number, y: number) => {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
};

/** Distance to a thick line segment — the chevron is two of these. */
const segment = (ax: number, ay: number, bx: number, by: number, halfThickness: number) => (x: number, y: number) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy) - halfThickness;
};

const union = (...fns: Array<(x: number, y: number) => number>) => (x: number, y: number) => Math.min(...fns.map((f) => f(x, y)));

/**
 * The rising chevron, drawn inside a square of side `inner` centred on the
 * canvas. `inner` is what implements the maskable safe zone: pass 80% of the
 * canvas and nothing important can be cropped.
 */
function chevron(size: number, inner: number) {
  const o = (size - inner) / 2;
  const t = inner * 0.115; // stroke half-thickness
  const px = (fx: number, fy: number): [number, number] => [o + fx * inner, o + fy * inner];
  const [ax, ay] = px(0.06, 0.74);
  const [bx, by] = px(0.38, 0.42);
  const [cx, cy] = px(0.58, 0.62);
  const [dx, dy] = px(0.94, 0.26);
  // The arrowhead: a short flag closing the top-right end of the stroke, so
  // the mark reads as direction rather than as an abstract zigzag.
  const [ex, ey] = px(0.94, 0.52);
  const [fx2, fy2] = px(0.68, 0.26);
  return union(
    segment(ax, ay, bx, by, t),
    segment(bx, by, cx, cy, t),
    segment(cx, cy, dx, dy, t),
    segment(dx, dy, ex, ey, t),
    segment(dx, dy, fx2, fy2, t),
  );
}

function encodePng(canvas: Canvas): Buffer {
  const { size, pixels } = canvas;
  // Filter byte 0 (None) per scanline — the images are flat colour, so a
  // smarter filter would buy nothing measurable.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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

function render(size: number, variant: "any" | "maskable"): Buffer {
  const maskable = variant === "maskable";
  const canvas = new Canvas(size, maskable ? GREEN : DARK);
  if (!maskable) {
    // A rounded plate keeps the dark icon from vanishing into a dark launcher
    // wallpaper; the maskable variant needs no plate, the launcher supplies one.
    canvas.fill(roundedRect(size / 2, size / 2, size * 0.46, size * 0.46, size * 0.22), DARK);
  }
  canvas.fill(chevron(size, size * (maskable ? 0.58 : 0.72)), maskable ? DARK : GREEN);
  return encodePng(canvas);
}

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

const written: string[] = [];
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size, "any"));
  writeFileSync(join(outDir, `icon-maskable-${size}.png`), render(size, "maskable"));
  written.push(`icon-${size}.png`, `icon-maskable-${size}.png`);
}
// iOS ignores the manifest's icons and reads apple-touch-icon at 180px.
writeFileSync(join(outDir, "apple-touch-icon.png"), render(180, "any"));
// The favicon: same mark, small enough that the plate is what carries it.
writeFileSync(join(outDir, "icon-32.png"), render(32, "any"));
written.push("apple-touch-icon.png", "icon-32.png");

console.log(`Wrote ${written.length} icons to public/icons: ${written.join(", ")}`);
