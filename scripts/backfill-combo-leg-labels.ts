/**
 * Repair ambiguous leg labels inside already-stored Combo Bet pick text.
 *
 * describeDouble used to concatenate each leg's STANDALONE pick, which is only
 * self-contained for some markets. A BTTS leg derives the pick "No" — fine
 * under a "Both Teams to Score" heading on its own card, meaningless once
 * concatenated:
 *
 *   stored:  "Doma United or Draw + No"
 *   correct: "Doma United or Draw + BTTS No"
 *
 * `pick` is a stored display string, so fixing the assembler does nothing for
 * rows that already exist. This rebuilds the combo pick from the two REFERENCED
 * LEG ROWS through describeComboLeg — the same function the assembler now uses
 * — and writes it back where it differs.
 *
 * Deliberately narrow. Only `pick`, only on marketType SAME_GAME_DOUBLE.
 * selection, confidence, reasoning, categories, settlement and status are never
 * touched: the bet itself is not being changed, only how it is spelled. Rows
 * whose leg references are missing or malformed are SKIPPED and reported, never
 * guessed at — a combo whose legs cannot be read is a row a human should look
 * at, not one a script should rewrite from its own stale text.
 *
 * Dry run by default. Run: npx tsx scripts/backfill-combo-leg-labels.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { describeComboLeg, type MarketType, type Selection } from "../src/lib/markets";

/** The leg fields the pick text is rebuilt from. */
export type ComboLegRow = {
  id: string;
  marketType: string;
  selection: unknown;
  market: string;
  pick: string;
  homeTeam: string | null;
  awayTeam: string | null;
};

export type SkipReason =
  | "NO_LEG_IDS"      // selection carries no legIds array at all
  | "BAD_LEG_IDS"     // not exactly two distinct string ids
  | "LEG_ROW_MISSING"; // a referenced leg row is not in the database

export type Reconstruction =
  | { ok: true; pick: string }
  | { ok: false; reason: SkipReason; detail: string };

/**
 * The two leg ids a double references, or null if the shape is not what the
 * assembler writes. Exported so the check suite can assert the malformed cases
 * without a database.
 */
export function readLegIds(selection: unknown): [string, string] | null {
  if (typeof selection !== "object" || selection === null) return null;
  const raw = (selection as Record<string, unknown>).legIds;
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 2) return null;
  if (!raw.every((v) => typeof v === "string" && v.length > 0)) return null;
  if (raw[0] === raw[1]) return null;
  return [raw[0] as string, raw[1] as string];
}

/**
 * Rebuild a combo's pick text from its legs, in the stored leg order.
 *
 * Order is taken from legIds rather than re-derived, so a repaired row keeps
 * reading the way it always has apart from the label fix.
 */
export function reconstructComboPick(selection: unknown, legs: Map<string, ComboLegRow>): Reconstruction {
  const ids = readLegIds(selection);
  if (ids === null) {
    const hasKey = typeof selection === "object" && selection !== null && "legIds" in (selection as object);
    return hasKey
      ? { ok: false, reason: "BAD_LEG_IDS", detail: JSON.stringify(selection).slice(0, 120) }
      : { ok: false, reason: "NO_LEG_IDS", detail: JSON.stringify(selection ?? null).slice(0, 120) };
  }
  const rows = ids.map((id) => legs.get(id));
  const missing = ids.filter((id) => !legs.has(id));
  if (missing.length) return { ok: false, reason: "LEG_ROW_MISSING", detail: missing.join(",") };
  const text = (r: ComboLegRow) =>
    describeComboLeg(r.marketType as MarketType, r.selection as Selection, r.homeTeam, r.awayTeam, {
      market: r.market,
      pick: r.pick,
    });
  return { ok: true, pick: `${text(rows[0]!)} + ${text(rows[1]!)}` };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../src/lib/prisma");

  const rows = await prisma.prediction.findMany({
    where: { marketType: "SAME_GAME_DOUBLE" },
    select: { id: true, pick: true, selection: true, homeTeam: true, awayTeam: true },
  });

  // One query for every referenced leg, rather than one per row.
  const legIds = [...new Set(rows.flatMap((r) => readLegIds(r.selection) ?? []))];
  const legRows = (await prisma.prediction.findMany({
    where: { id: { in: legIds } },
    select: { id: true, marketType: true, selection: true, market: true, pick: true, homeTeam: true, awayTeam: true },
  })) as ComboLegRow[];
  const legs = new Map(legRows.map((l) => [l.id, l]));

  let changed = 0;
  let alreadyCorrect = 0;
  const skipped: Array<{ id: string; reason: SkipReason; detail: string }> = [];
  const samples: string[] = [];

  for (const r of rows) {
    const result = reconstructComboPick(r.selection, legs);
    if (!result.ok) {
      skipped.push({ id: r.id, reason: result.reason, detail: result.detail });
      continue;
    }
    if (result.pick === r.pick) {
      alreadyCorrect++;
      continue;
    }
    changed++;
    if (samples.length < 5) {
      samples.push(`  ${r.homeTeam} v ${r.awayTeam}\n    BEFORE: ${r.pick}\n    AFTER : ${result.pick}`);
    }
    if (apply) {
      await prisma.prediction.update({ where: { id: r.id }, data: { pick: result.pick } });
    }
  }

  console.log(`SAME_GAME_DOUBLE rows : ${rows.length}`);
  console.log(`  already correct     : ${alreadyCorrect}`);
  console.log(`  pick to rewrite     : ${changed}`);
  console.log(`  skipped             : ${skipped.length}`);
  if (skipped.length) {
    const byReason = new Map<string, number>();
    for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    for (const [reason, n] of byReason) console.log(`      ${reason.padEnd(16)} ${n}`);
    for (const s of skipped.slice(0, 5)) console.log(`      ${s.id.slice(0, 8)}  ${s.reason}  ${s.detail}`);
  }
  if (samples.length) console.log(`\nsamples:\n${samples.join("\n")}`);
  console.log(`\n${apply ? "APPLIED" : "DRY RUN — re-run with --apply to write"}`);

  await prisma.$disconnect();
}

// Guarded: check-combo-bet-copy.ts imports the pure helpers above, and an
// unguarded main() would open a database connection on import.
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
