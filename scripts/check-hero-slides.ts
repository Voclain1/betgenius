/**
 * The homepage hero slider's picks (src/lib/heroSlides.ts): 3-6 of the day's
 * highest-confidence public picks, fixed for the day once shown. Pure.
 *
 * Run: npx tsx scripts/check-hero-slides.ts
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectHeroSlides, HERO_MAX_SLIDES, HERO_MIN_SLIDES, HERO_MIN_CONFIDENCE, type HeroSlideData } from "../src/lib/heroSlides";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
let n = 0;
const row = (confidence: number, over: Partial<HeroSlideData> = {}): HeroSlideData => {
  n++;
  return {
    id: `p${n}`, homeTeam: `H${n}`, awayTeam: `A${n}`, homeTeamApiId: n * 10, awayTeamApiId: n * 10 + 1, kickoff: new Date(Date.UTC(2026, 9, 18, 12 + (n % 8))),
    leagueName: "League", leagueApiId: 39, market: "Match Winner", pick: "x", confidence, outcome: null, finalHomeScore: null, finalAwayScore: null, ...over,
  };
};
const ids = (r: { slides: HeroSlideData[] }) => r.slides.map((s) => s.id);

check("limits: 3 to 6 slides, from 70% up", HERO_MIN_SLIDES === 3 && HERO_MAX_SLIDES === 6 && HERO_MIN_CONFIDENCE === 70);

const many = [65, 71, 90, 82, 77, 88, 74, 79, 69].map((c) => row(c));
const first = selectHeroSlides(many, null);
check("a busy day shows 6, highest confidence first", JSON.stringify(first.slides.map((s) => s.confidence)) === JSON.stringify([90, 88, 82, 79, 77, 74]), first.slides.map((s) => s.confidence));
check("nothing under 70% when enough qualify", first.slides.every((s) => s.confidence >= 70));

const thin = [72, 75, 60].map((c) => row(c));
check("a thin day shows only what qualifies (2)", selectHeroSlides(thin, null).slides.length === 2);
const none = [60, 65].map((c) => row(c));
const noneSel = selectHeroSlides(none, null);
check("nothing qualifies: the day's single best pick, never an empty hero", noneSel.slides.length === 1 && noneSel.slides[0].confidence === 65);
check("no picks at all: no slides", selectHeroSlides([], null).slides.length === 0);

// One slide per match.
const dupA = row(85, { homeTeamApiId: 1, awayTeamApiId: 2 });
const dupB = row(80, { homeTeamApiId: 1, awayTeamApiId: 2 });
const dedup = selectHeroSlides([dupA, dupB, row(75)], null);
check("one slide per match, its strongest pick", dedup.slides.length === 2 && dedup.slides[0].id === dupA.id);

// Fixed for the day.
const later = [...many, row(99)];
const pinned = selectHeroSlides(later, first.ids);
check("a stronger pick published later does not replace a stored slide", JSON.stringify(ids(pinned)) === JSON.stringify(first.ids), ids(pinned));
const settled = many.map((r) => (r.id === first.ids[0] ? { ...r, outcome: "WON", finalHomeScore: 2, finalAwayScore: 0 } : r));
check("a settled pick keeps its place and carries its result", selectHeroSlides(settled, first.ids).slides[0].outcome === "WON");
const unpublished = many.filter((r) => r.id !== first.ids[1]);
const afterDrop = selectHeroSlides(unpublished, first.ids);
check("an unpublished pick drops out; the rest keep their order", JSON.stringify(ids(afterDrop)) === JSON.stringify(first.ids.filter((_, i) => i !== 1)));

// Topped up only while under the minimum.
const early = [row(80)];
const earlySel = selectHeroSlides(early, null);
const grown = selectHeroSlides([...early, row(90), row(70), row(85)], earlySel.ids);
check("a short stored list is topped up to 3, keeping its first slide first", grown.slides.length === 3 && grown.slides[0].id === earlySel.ids[0] && grown.slides[1].confidence === 90, grown.slides.map((s) => s.confidence));

// Wiring.
const page = readFileSync(join(__dirname, "../src/app/(public)/page.tsx"), "utf8");
check("homepage hero renders the slider from getHeroSlides", page.includes("getHeroSlides()") && page.includes("<HeroSlider slides={heroSlides} />"));
const lib = readFileSync(join(__dirname, "../src/lib/heroSlides.ts"), "utf8");
check("only public categories feed the hero", lib.includes('categories: { some: { category: { in: ["FEATURED", "GENIUS"] } } }'));
check("the day's selection is stored per Lagos date", lib.includes("hero-slides:${day}") && lib.includes("lagosDateKey(now)"));
const slider = readFileSync(join(__dirname, "../src/components/HeroSlider.tsx"), "utf8");
check("autoplay respects reduced motion and stops once touched", slider.includes("prefers-reduced-motion: reduce") && slider.includes("onTouchStart={stop}"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll hero slider checks passed");
