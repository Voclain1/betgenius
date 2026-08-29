/**
 * Validates the brand artwork the site ships and the metadata that points at it.
 *
 * Every failure this catches is one that is invisible in development and
 * permanent in production: an icon path that 404s still renders a page, a
 * truncated PNG still has a plausible file size, an installed PWA keeps the
 * icon it was installed with, and a social card is only ever seen by other
 * people. The brand pack that seeded these files shipped one PNG truncated
 * mid-stream, which is exactly the class of problem a byte-level check finds
 * and a glance at a directory listing does not.
 *
 * What is asserted:
 *   - every path named in the metadata, the manifest and the nav exists,
 *   - every PNG is structurally complete and is the size it claims to be,
 *   - the manifest still satisfies the install/TWA requirements (name,
 *     start_url, display, and a 512px maskable icon),
 *   - the maskable icons really do keep the mark inside the 80% safe zone,
 *     which is the one property Android silently ruins if it is wrong.
 *
 * Run: npx tsx scripts/check-brand-assets.ts
 */
export {};

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { inflateSync } from "zlib";
import manifest from "../src/app/manifest";
import {
  BRAND_ICON_DARK,
  BRAND_ICON_LIGHT,
  BRAND_ICON_SIZE,
  SOCIAL_CARD,
  SOCIAL_CARD_SIZE,
} from "../src/lib/brandAssets";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};

const publicPath = (webPath: string) => join(process.cwd(), "public", webPath.replace(/^\//, ""));

// ---------------------------------------------------------------------------
// PNG integrity
// ---------------------------------------------------------------------------

type PngInfo = { width: number; height: number; colourType: number; complete: boolean; pixels?: Uint8Array };

/**
 * Walks a PNG's chunk list and decodes it.
 *
 * `complete` is the point of this: a chunk whose declared length runs past the
 * end of the file, or a stream with no IEND, means a truncated download. Both
 * are things a browser renders as a partial image rather than an error, so
 * nothing upstream of here would report it.
 */
function inspectPng(path: string): PngInfo {
  const buf = readFileSync(path);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colourType = buf[25];

  let pos = 8;
  let sawEnd = false;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) return { width, height, colourType, complete: false };
    if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) return { width, height, colourType, complete: false };

  // The chunk table can be intact while the compressed stream is not.
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return { width, height, colourType, complete: false };
  }
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (channels === 0) return { width, height, colourType, complete: true };
  if (raw.length !== height * (width * channels + 1)) return { width, height, colourType, complete: false };
  return { width, height, colourType, complete: true };
}

function expectPng(webPath: string, expected?: { width: number; height: number }) {
  const path = publicPath(webPath);
  if (!existsSync(path)) {
    check(`${webPath} exists`, false);
    return;
  }
  check(`${webPath} exists`, true);
  let info: PngInfo;
  try {
    info = inspectPng(path);
  } catch (e) {
    check(`${webPath} is a readable PNG`, false, String(e));
    return;
  }
  check(`${webPath} is a complete PNG (not truncated)`, info.complete);
  if (expected) {
    check(
      `${webPath} is ${expected.width}x${expected.height}`,
      info.width === expected.width && info.height === expected.height,
      `${info.width}x${info.height}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

// Favicons and touch icons, at the sizes the document head advertises.
check("/favicon.ico exists", existsSync(publicPath("/favicon.ico")));
expectPng("/icons/icon-16.png", { width: 16, height: 16 });
expectPng("/icons/icon-32.png", { width: 32, height: 32 });
expectPng("/icons/icon-48.png", { width: 48, height: 48 });
expectPng("/icons/apple-touch-icon.png", { width: 180, height: 180 });

// The nav mark, both colourways — same artwork, same box, or the bar reflows
// when the theme is switched.
expectPng(BRAND_ICON_DARK, BRAND_ICON_SIZE);
expectPng(BRAND_ICON_LIGHT, BRAND_ICON_SIZE);
expectPng(SOCIAL_CARD, SOCIAL_CARD_SIZE);

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

const m = manifest();

// The fields an install prompt and Play Store packaging both refuse to proceed
// without. Checked by name rather than by shape so a rename is a failure here
// and not a silently uninstallable app.
check("manifest: has name", typeof m.name === "string" && m.name.length > 0, m.name);
check("manifest: has short_name", typeof m.short_name === "string" && m.short_name!.length > 0, m.short_name);
check("manifest: start_url is /", m.start_url === "/", m.start_url);
check("manifest: display is standalone", m.display === "standalone", m.display);
check("manifest: scope covers start_url", m.start_url!.startsWith(m.scope ?? "/"), { scope: m.scope });

const icons = m.icons ?? [];
for (const icon of icons) {
  expectPng(icon.src, icon.sizes ? sizeOf(icon.sizes) : undefined);
  check(`manifest: ${icon.src} declares image/png`, icon.type === "image/png", icon.type);
}

function sizeOf(sizes: string): { width: number; height: number } | undefined {
  const m2 = /^(\d+)x(\d+)$/.exec(sizes.trim());
  return m2 ? { width: Number(m2[1]), height: Number(m2[2]) } : undefined;
}

const has = (purpose: string, size: string) =>
  icons.some((i) => i.purpose === purpose && i.sizes === size);
check("manifest: has a 192px any icon", has("any", "192x192"));
check("manifest: has a 512px any icon", has("any", "512x512"));
check("manifest: has a 192px maskable icon", has("maskable", "192x192"));
// The one Play Store packaging reads for the launcher icon and splash screen.
check("manifest: has a 512px maskable icon", has("maskable", "512x512"));

// ---------------------------------------------------------------------------
// Maskable safe zone
// ---------------------------------------------------------------------------

/**
 * The mark in a maskable icon must sit inside the centre 80%, because Android
 * crops the rest away to fit its launcher shape. Measured, not assumed: the
 * generator is what puts it there, and a regenerate against different source
 * artwork is exactly when this would quietly stop being true.
 */
function checkSafeZone(webPath: string) {
  const path = publicPath(webPath);
  if (!existsSync(path)) return;
  const decoded = decodeForBounds(path);
  if (!decoded) return;
  const { width, height, pixels } = decoded;
  const ground = [pixels[0], pixels[1], pixels[2]];
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const delta =
        Math.abs(pixels[i] - ground[0]) + Math.abs(pixels[i + 1] - ground[1]) + Math.abs(pixels[i + 2] - ground[2]);
      if (delta <= 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    check(`${webPath} contains a mark`, false);
    return;
  }
  // A one-pixel allowance: the mark is centred to within half a pixel and the
  // box filter feathers its edge.
  const margin = width * 0.1 - 1;
  check(
    `${webPath}: mark is inside the 80% safe zone`,
    minX >= margin && minY >= margin && maxX <= width - 1 - margin && maxY <= height - 1 - margin,
    { minX, minY, maxX, maxY, margin: Math.round(margin) },
  );
  const cx = (minX + maxX) / 2 - width / 2;
  const cy = (minY + maxY) / 2 - height / 2;
  check(
    `${webPath}: mark is centred`,
    Math.abs(cx) <= 1.5 && Math.abs(cy) <= 1.5,
    { dx: cx, dy: cy },
  );
}

/** Decodes an 8-bit truecolour PNG to RGBA. Returns null for anything else. */
function decodeForBounds(path: string): { width: number; height: number; pixels: Uint8Array } | null {
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (buf[24] !== 8) return null;
  const colourType = buf[25];
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (channels === 0 || buf[28] !== 0) return null;

  let pos = 8;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) return null;
    if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
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
        default: break;
      }
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = out[i * channels];
    pixels[i * 4 + 1] = out[i * channels + 1];
    pixels[i * 4 + 2] = out[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? out[i * channels + 3] : 255;
  }
  return { width, height, pixels };
}

for (const icon of icons.filter((i) => i.purpose === "maskable")) checkSafeZone(icon.src);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
console.log(`All ${passed} brand asset checks passed.`);
