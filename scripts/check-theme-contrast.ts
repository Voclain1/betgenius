/**
 * Verifies both themes are actually legible, by computing WCAG contrast ratios
 * from the token values in globals.css.
 *
 * "Both should display very well" is not checkable by looking at one theme and
 * assuming the other inverted cleanly — the light palette is hand-picked, and
 * the failure mode is a specific pairing (pale green text on a pale green chip)
 * rather than the theme as a whole. So every pairing the app actually renders
 * is scored.
 *
 * Parses the CSS rather than duplicating the values here: a copy would drift,
 * and then this would be verifying itself instead of the stylesheet.
 *
 * Run: npx tsx scripts/check-theme-contrast.ts
 */
export {};

import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Pull one theme's token block out of the stylesheet. */
function tokens(selector: string): Record<string, [number, number, number]> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = css.slice(open, end);
  const out: Record<string, [number, number, number]> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const relLum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Composite a translucent foreground over an opaque background — chips use this. */
const over = (fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] =>
  [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as [number, number, number];

/**
 * Every pairing the app renders, with the minimum ratio each must clear.
 *
 * 4.5 is the WCAG AA threshold for body text. 3.0 applies to large/bold text
 * and to non-text boundaries like borders, where AA is more permissive — a
 * card border at 4.5 would be a harsh line, not a better one.
 */
const PAIRS: Array<{ label: string; fg: string; bg: string; min: number; alpha?: number; onCard?: boolean }> = [
  { label: "body text on page", fg: "gray-200", bg: "bg", min: 4.5 },
  { label: "body text on card", fg: "gray-200", bg: "card", min: 4.5 },
  { label: "heading on card", fg: "gray-100", bg: "card", min: 4.5 },
  { label: "secondary text on card", fg: "gray-300", bg: "card", min: 4.5 },
  { label: "muted text on card", fg: "gray-400", bg: "card", min: 4.5 },
  { label: "faint text on card", fg: "gray-500", bg: "card", min: 3.0 },
  // `text-brand` is body-size link text throughout, so it is held to the
  // 4.5:1 body threshold rather than the 3.0 large-text one.
  { label: "brand link on page", fg: "brand", bg: "bg", min: 4.5 },
  { label: "brand link on card", fg: "brand", bg: "card", min: 4.5 },
  { label: "on-brand text on brand button", fg: "on-brand", bg: "brand", min: 4.5 },
  { label: "card border vs page", fg: "border", bg: "bg", min: 1.1 },
  { label: "VIP accent on card", fg: "vip", bg: "card", min: 3.0 },
  { label: "Premium accent on card", fg: "premium", bg: "card", min: 3.0 },
];

/** Outcome chips: translucent tinted background with coloured text on top. */
const CHIPS: Array<{ label: string; text: string; tint: string; alpha: number }> = [
  { label: "WON chip", text: "emerald-300", tint: "emerald-500", alpha: 0.2 },
  { label: "LOST chip", text: "red-300", tint: "red-500", alpha: 0.2 },
  { label: "VOID chip", text: "gray-300", tint: "gray-500", alpha: 0.2 },
];

const failures: string[] = [];
let checks = 0;

for (const [themeName, selector] of [
  ["DARK", ":root[data-theme=\"dark\"]"],
  ["LIGHT", ":root[data-theme=\"light\"]"],
] as const) {
  const t = tokens(selector);
  console.log(`\n=== ${themeName} ===`);

  for (const p of PAIRS) {
    const fg = t[p.fg];
    const bg = t[p.bg];
    if (!fg || !bg) {
      failures.push(`${themeName}: missing token ${!fg ? p.fg : p.bg}`);
      continue;
    }
    const ratio = contrast(fg, bg);
    checks++;
    const ok = ratio >= p.min;
    if (!ok) failures.push(`${themeName}: ${p.label} is ${ratio.toFixed(2)}:1, needs ${p.min}:1`);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${p.label.padEnd(32)} ${ratio.toFixed(2)}:1 (min ${p.min})`);
  }

  for (const c of CHIPS) {
    const text = t[c.text];
    const tint = t[c.tint];
    const card = t["card"];
    if (!text || !tint || !card) {
      failures.push(`${themeName}: missing chip token for ${c.label}`);
      continue;
    }
    // The chip's effective background is its tint composited over the card.
    const effective = over(tint, card, c.alpha);
    const ratio = contrast(text, effective);
    checks++;
    const ok = ratio >= 4.5;
    if (!ok) failures.push(`${themeName}: ${c.label} text is ${ratio.toFixed(2)}:1 on its own tint, needs 4.5:1`);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.label.padEnd(32)} ${ratio.toFixed(2)}:1 (min 4.5)`);
  }

  // The two themes must genuinely differ, or a broken selector would pass
  // everything by silently rendering one theme twice.
  const bgLum = relLum(t["bg"]);
  console.log(`  page background luminance: ${bgLum.toFixed(3)} (${bgLum < 0.5 ? "dark" : "light"})`);
}

// Cross-theme sanity: the two palettes must not be identical.
const dark = tokens(":root[data-theme=\"dark\"]");
const light = tokens(":root[data-theme=\"light\"]");
const identical = Object.keys(dark).every((k) => String(dark[k]) === String(light[k]));
if (identical) failures.push("dark and light token blocks are identical — one selector is not being applied");
if (relLum(dark["bg"]) >= relLum(light["bg"])) failures.push("dark background is not darker than light background");

// Every token defined in one theme must exist in the other, or a class will
// resolve to nothing in whichever block forgot it.
for (const k of Object.keys(dark)) if (!(k in light)) failures.push(`--${k} defined for dark but missing from light`);
for (const k of Object.keys(light)) if (!(k in dark)) failures.push(`--${k} defined for light but missing from dark`);

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${checks} contrast checks across both themes`);
for (const f of failures) console.log(`  ${f}`);
if (failures.length) process.exitCode = 1;
