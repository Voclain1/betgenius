/**
 * Measures the intrinsic width of the desktop nav bar and fails if it exceeds
 * the container it has to fit in.
 *
 * WHY THIS EXISTS. The nav has overflowed twice — once below md with no
 * hamburger to fall back on, once at desktop width when a 13-link flat row
 * outgrew the bar and had to be regrouped behind Tips/More. Both were found in
 * a browser, after shipping. The bar is `flex justify-between` inside
 * `max-w-7xl px-4`, which means it has NO gap of its own and NO wrapping: the
 * children sit at their intrinsic widths and, the moment those sum past the
 * container, the row pushes out instead of reflowing. That failure is a pure
 * function of the link labels, the paddings and the font — all of which are
 * knowable here, without a browser.
 *
 * HOW THE TEXT IS MEASURED. Not estimated: the advance widths come out of the
 * real Segoe UI files in C:\Windows\Fonts, read glyph by glyph through the
 * font's cmap and hmtx tables. Segoe UI is what the app's font stack
 * (tailwind.config.ts) resolves to on Windows, and it is the widest of the
 * realistic resolutions, so a bar that fits in Segoe UI fits in the others.
 * Where the font is absent — CI, a Linux box — the script says so and skips
 * rather than substituting a guess and reporting a number nobody should trust.
 *
 * WHAT IT DOES NOT CATCH. Sub-pixel rounding, letter-spacing from
 * `tracking-tight`, and the exact icon metrics of lucide glyphs are all taken
 * at their nominal values. Treat the output as accurate to a pixel or two, not
 * to the pixel. It is a regression guard on a budget with ~200px of headroom,
 * not a rendering engine.
 *
 * Run: npx tsx scripts/check-nav-width.ts
 */
export {};

import { readFileSync, existsSync } from "fs";

// ---------------------------------------------------------------------------
// Font metrics
// ---------------------------------------------------------------------------

type Font = { unitsPerEm: number; widths: Map<number, number> };

/**
 * Reads the advance width of every mapped character out of a TrueType file.
 *
 * Only the three tables that matter are parsed: head (unitsPerEm), hhea
 * (numberOfHMetrics) and hmtx (the advances), joined to characters through a
 * format-4 cmap subtable. Format 4 is what every Windows UI font uses for the
 * BMP, and the labels in this nav are all ASCII.
 */
function readFont(path: string): Font {
  const buf = readFileSync(path);
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString("ascii", rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  const need = (tag: string) => {
    const off = tables.get(tag);
    if (off === undefined) throw new Error(`font ${path} has no ${tag} table`);
    return off;
  };

  const unitsPerEm = buf.readUInt16BE(need("head") + 18);
  const numHMetrics = buf.readUInt16BE(need("hhea") + 34);
  const hmtx = need("hmtx");
  const advanceOf = (glyph: number) =>
    buf.readUInt16BE(hmtx + Math.min(glyph, numHMetrics - 1) * 4);

  // Pick the Windows BMP (3,1) cmap subtable, falling back to any format 4.
  const cmap = need("cmap");
  const subtables = buf.readUInt16BE(cmap + 2);
  let best = -1;
  for (let i = 0; i < subtables; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = cmap + buf.readUInt32BE(rec + 4);
    if (buf.readUInt16BE(offset) !== 4) continue;
    if (platform === 3 && encoding === 1) best = offset;
    else if (best < 0) best = offset;
  }
  if (best < 0) throw new Error(`font ${path} has no format 4 cmap`);

  const segCount = buf.readUInt16BE(best + 6) / 2;
  const endAt = best + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;

  const widths = new Map<number, number>();
  for (let seg = 0; seg < segCount; seg++) {
    const end = buf.readUInt16BE(endAt + seg * 2);
    const start = buf.readUInt16BE(startAt + seg * 2);
    if (start === 0xffff) continue;
    const delta = buf.readInt16BE(deltaAt + seg * 2);
    const rangeOffset = buf.readUInt16BE(rangeAt + seg * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const at = rangeAt + seg * 2 + rangeOffset + (code - start) * 2;
        if (at + 1 >= buf.length) continue;
        glyph = buf.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) widths.set(code, advanceOf(glyph));
    }
  }
  return { unitsPerEm, widths };
}

const FONT_DIR = "C:/Windows/Fonts";
const FONT_FILES = {
  regular: `${FONT_DIR}/segoeui.ttf`,
  semibold: `${FONT_DIR}/seguisb.ttf`,
  bold: `${FONT_DIR}/segoeuib.ttf`,
} as const;
type Weight = keyof typeof FONT_FILES;

const missing = Object.values(FONT_FILES).filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.log(`SKIP: Segoe UI not installed (${missing.join(", ")}). Nothing measured.`);
  process.exit(0);
}

const FONTS: Record<Weight, Font> = {
  regular: readFont(FONT_FILES.regular),
  semibold: readFont(FONT_FILES.semibold),
  bold: readFont(FONT_FILES.bold),
};

/** Rendered width of `text` at `px`, in CSS pixels. */
function textWidth(text: string, px: number, weight: Weight = "regular"): number {
  const font = FONTS[weight];
  let units = 0;
  for (const ch of text) units += font.widths.get(ch.codePointAt(0)!) ?? font.widths.get(0x20) ?? 0;
  return (units / font.unitsPerEm) * px;
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

// Tailwind scale, in pixels. Named rather than inlined so a class change in
// Nav.tsx has one obvious place to land.
const TEXT_SM = 14;
const TEXT_XL = 20;
const PX_3 = 12; // px-3, per side
const PX_4 = 16; // px-4, per side
const GAP_1 = 4;
const GAP_2 = 8;
const CHEVRON = 14; // <ChevronDown size={14} />
const THEME_TOGGLE = 36; // h-9 w-9
const CONTAINER = 1280; // max-w-7xl
const CONTAINER_PADDING = PX_4 * 2;

/** Width of the icon mark at `h-7`, preserving its 520x530 aspect ratio. */
const MARK_WIDTH = (28 * 520) / 530;

const item = (label: string, px: number, weight: Weight, padding: number, extra = 0) => ({
  label,
  width: textWidth(label, px, weight) + padding * 2 + extra,
});

// The desktop link row: Tips dropdown, three primary links, More dropdown,
// separated by gap-1.
const navItems = [
  item("Tips", TEXT_SM, "regular", PX_3, GAP_1 + CHEVRON),
  item("Bet Builder", TEXT_SM, "regular", PX_3),
  item("Multi Bets", TEXT_SM, "regular", PX_3),
  item("Track Record", TEXT_SM, "regular", PX_3),
  item("More", TEXT_SM, "regular", PX_3, GAP_1 + CHEVRON),
];
const navRow = navItems.reduce((n, i) => n + i.width, 0) + GAP_1 * (navItems.length - 1);

// Logged out is the wider of the two auth states: "Log in" + "Join" against
// "Admin" + "Account" + "Log out" — checked below, not assumed.
const authRow = (labels: string[]) =>
  labels.reduce((n, l) => n + textWidth(l, TEXT_SM, "regular") + PX_4 * 2, 0) + GAP_2 * (labels.length - 1);
const AUTH_SIGNED_OUT = authRow(["Log in", "Join"]);
const AUTH_ADMIN = authRow(["Admin", "Account", "Log out"]);
const auth = Math.max(AUTH_SIGNED_OUT, AUTH_ADMIN);

/** The hamburger, below md: btn base + p-2 override around a 20px lucide glyph. */
const HAMBURGER = 20 + 8 * 2;

const budget = (viewport: number) => viewport - CONTAINER_PADDING;
const fmt = (n: number) => `${n.toFixed(1)}px`;

const WORDMARK_XL = textWidth("BetGenius", TEXT_XL, "bold");
/** The logo as it was: live text only. */
const LOGO_BEFORE = WORDMARK_XL;
/** The logo now: the pack's mark, then gap-2, then the same live text. */
const LOGO_AFTER = MARK_WIDTH + GAP_2 + WORDMARK_XL;

/**
 * The breakpoints the bar actually has to survive, widest search box first.
 *
 * Below md the link row, the search box and the auth actions are all in the
 * drawer, so the bar holds three things and the question stops being
 * interesting — which is why 375px has its own row rather than a `search`
 * value.
 */
type Case = { name: string; viewport: number; search: number | null; inScope: boolean };
const CASES: Case[] = [
  { name: "1280px (xl:w-64)", viewport: 1280, search: 256, inScope: true },
  { name: "1024px (lg:w-56)", viewport: 1024, search: 224, inScope: false },
  { name: " 768px (md:w-44)", viewport: 768, search: 176, inScope: false },
  { name: " 375px (drawer)  ", viewport: 375, search: null, inScope: true },
];

/** Everything in the bar except the logo, at one breakpoint. */
function rest(c: Case, authWidth: number): number {
  // Below md: theme toggle and hamburger only.
  if (c.search === null) return THEME_TOGGLE + HAMBURGER;
  return navRow + c.search + THEME_TOGGLE + authWidth;
}

console.log("Nav bar intrinsic width (max-w-7xl px-4, flex justify-between — no gap, no wrap)");
console.log("Text measured from the real Segoe UI advance widths.\n");

console.log("  logo");
console.log(`    text wordmark (before)       ${fmt(LOGO_BEFORE)}`);
console.log(`    mark + wordmark (after)      ${fmt(LOGO_AFTER)}   (mark ${fmt(MARK_WIDTH)} at h-7 + gap-2 ${GAP_2}px)`);
console.log(`    delta                        +${fmt(LOGO_AFTER - LOGO_BEFORE)}\n`);

console.log("  parts");
for (const i of navItems) console.log(`    nav "${i.label}"${" ".repeat(Math.max(0, 24 - i.label.length))}${fmt(i.width)}`);
console.log(`    nav row incl. gap-1          ${fmt(navRow)}`);
console.log(`    theme toggle (h-9 w-9)       ${fmt(THEME_TOGGLE)}`);
console.log(`    hamburger (p-2, 20px glyph)  ${fmt(HAMBURGER)}`);
console.log(`    auth, signed out             ${fmt(AUTH_SIGNED_OUT)}`);
console.log(`    auth, admin                  ${fmt(AUTH_ADMIN)}\n`);

console.log("  totals, worst-case auth state");
console.log("    viewport            budget    before     after     slack");
const failures: string[] = [];
const preexisting: string[] = [];
for (const c of CASES) {
  const b = budget(c.viewport);
  const before = LOGO_BEFORE + rest(c, auth);
  const after = LOGO_AFTER + rest(c, auth);
  const slack = b - after;
  const flag = slack >= 0 ? "ok" : before > b ? "OVER (already was)" : "OVER (regression)";
  console.log(
    `    ${c.name}  ${fmt(b).padStart(8)}  ${fmt(before).padStart(8)}  ${fmt(after).padStart(8)}  ${fmt(slack).padStart(8)}  ${flag}`,
  );
  if (slack >= 0) continue;
  // A width that was already over before this change is not this change's
  // regression, and failing the build on it would only teach people to ignore
  // the check. It is still reported, loudly, at the end.
  if (before > b) {
    // Which auth states are affected matters: at lg only the admin row tips it
    // over, and saying "overflows" flatly would send someone hunting for a bug
    // they cannot reproduce signed out.
    const signedOut = LOGO_AFTER + rest(c, AUTH_SIGNED_OUT) - b;
    const who = signedOut > 0 ? "every visitor" : "signed-in admins only";
    preexisting.push(
      `${c.name.trim()} overflows by ${fmt(-slack)}, ${who} (already ${fmt(before - b)} over before the logo change)`,
    );
  }
  else failures.push(`${c.name.trim()} overflows by ${fmt(-slack)} — the logo change caused this`);
}

// The two widths this check is a contract for. Everything else is advisory.
for (const c of CASES.filter((x) => x.inScope)) {
  const over = LOGO_AFTER + rest(c, auth) - budget(c.viewport);
  if (over > 0 && !failures.some((f) => f.startsWith(c.name.trim()))) {
    failures.push(`${c.name.trim()} overflows by ${fmt(over)}`);
  }
}

if (preexisting.length > 0) {
  console.log("\n  PRE-EXISTING (not caused by the logo, not fixed here):");
  for (const w of preexisting) console.log(`    - ${w}`);
  console.log("    The bar keeps the full desktop link row from md up but only gets");
  console.log("    the md search box; signed-in admins add a third auth button. Either");
  console.log("    the groups move behind the drawer until lg, or the auth actions");
  console.log("    collapse to an avatar menu.");
}

console.log("");
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log("PASS: the nav fits at 1280px and 375px with the new logo.");
