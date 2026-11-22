/**
 * OFFLINE SIMULATION — not production data.
 *
 * Replays the early lane's evidence-completeness rule, BEFORE (flat 12h team /
 * 24h standings floor) and AFTER (lead-time tolerance + supersession), over
 * the cache-age process the code itself defines: the enrichment cron refreshes
 * a team when its cache exceeds its REFRESH_TIERS tolerance (3h/12h/48h by
 * kickoff distance), so at a random moment a team's cache age is uniform on
 * [0, tolerance + scheduler lag]. Unknowns are swept, not assumed:
 *   - lag: how late the cron actually gets to a due team (0h, 6h, 24h)
 *   - standings refresh period (24h, 48h)
 *   - match spacing per team (84h ≈ two games a week, 168h ≈ one)
 * Output: expected share of early drafts with complete evidence, by band.
 *
 *   npx tsx scripts/simulate-early-freshness.ts
 */
import { teamToleranceMs, standingsToleranceMs } from "../src/lib/ai/evidenceFreshness";
import { REFRESH_TIERS } from "../src/lib/enrichment";

const H = 3_600_000;
const tierMaxH = (leadH: number) => REFRESH_TIERS.find(t => leadH <= t.withinHours)!.maxAgeMs / H;
/** P(U[0,max] <= x) */
const cdf = (x: number, max: number) => max <= 0 ? 1 : Math.max(0, Math.min(1, x / max));
/** E over age~U[0,max] of [age <= x] * P(no match in the last `age` hours | spacing) */
function pCurrent(x: number, max: number, spacingH: number | null, steps = 400): number {
  if (spacingH === null) return cdf(x, max);
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    const age = ((i + 0.5) / steps) * max;
    if (age <= x) acc += Math.max(0, 1 - age / spacingH);
  }
  return acc / steps;
}
/** Same, but the part of [age<=x] that MISSES a match (old rule passed it as complete). */
function pYoungButSuperseded(x: number, max: number, spacingH: number, steps = 400): number {
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    const age = ((i + 0.5) / steps) * max;
    if (age <= x) acc += Math.min(1, age / spacingH);
  }
  return acc / steps;
}

const bands = [
  { label: "48–72h", from: 48, to: 72 },
  { label: "3–7 days", from: 72, to: 168 },
  { label: "7–14 days", from: 168, to: 336 },
];
const rows: string[] = ["band,lag_h,standings_period_h,match_spacing_h,before_complete_pct,before_complete_but_superseded_pct,after_complete_pct"];
for (const lag of [0, 6, 24]) for (const sp of [24, 48]) for (const spacing of [84, 168]) for (const b of bands) {
  let before = 0, beforeSup = 0, after = 0, n = 0;
  for (let lead = b.from + 0.5; lead < b.to; lead += 1) {
    const teamMax = tierMaxH(lead) + lag;
    const stMax = sp + lag;
    // BEFORE: each team <= 12h, standings <= 24h (assumes standings present).
    const teamOld = cdf(12, teamMax);
    const stOld = cdf(24, stMax);
    before += teamOld * teamOld * stOld;
    // Of those, at least one team missed a match played since its fetch.
    const teamOldClean = pCurrent(12, teamMax, spacing);
    beforeSup += (teamOld * teamOld - teamOldClean * teamOldClean) * stOld;
    // AFTER: each team within lead tolerance AND not superseded; standings within lead tolerance.
    const teamNew = pCurrent(teamToleranceMs(lead) / H, teamMax, spacing);
    const stNew = cdf(standingsToleranceMs(lead) / H, stMax);
    after += teamNew * teamNew * stNew;
    n++;
    void pYoungButSuperseded;
  }
  rows.push([b.label, lag, sp, spacing, (100 * before / n).toFixed(1), (100 * beforeSup / n).toFixed(1), (100 * after / n).toFixed(1)].join(","));
}
console.log("SIMULATION (not production data): share of early drafts whose evidence passes the completeness rule");
console.log(rows.join("\n"));
