/**
 * Strip leaked house terminology from ALREADY-PUBLISHED reasoning.
 *
 * The prompt and the generation scan stop new drafts from narrating our tiers
 * and calibrations at the reader, but neither reaches rows that are already
 * live. Those rows say things like "under the Genius tier risk calibration",
 * which means nothing to a reader and describes our pipeline, not the match.
 *
 * This EDITS rather than rejects, which is the opposite of what the generation
 * scan does — deliberately, because the trade-off is different. At generation
 * time a rejected draft can simply be regenerated. For a published row the
 * choice is between leaving the leak visible to readers and removing the
 * clause, and the clauses here are adverbial: they attach a house rule to a
 * claim that stands perfectly well without it.
 *
 * Every edit is re-scanned afterwards, and anything still tripping the scan is
 * reported rather than silently left half-cleaned.
 *
 * Dry run by default. Run: npx tsx scripts/backfill-house-voice.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

// Regex LITERALS. Built with new RegExp(`...`) these read \\b as a backspace
// control character rather than a word boundary, and matched nothing.

/** Leading adverbial clause: "Under VIP risk calibration, backing X..." */
const LEADING = /^\s*(under|given|in accordance with|in line with|per|following)\b[^,]{0,90}\bcalibration\b[^,]{0,60},\s*/i;

/** Trailing or inline: "...a well-supported position under the Genius tier risk calibration." */
const INLINE = /,?\s*\b(under|given|per|following)\s+(the\s+)?(genius|vip|premium|banker)?\s*(tier\s+)?(risk\s+)?calibration\b(\s+(toward|towards)\s+risk\s+mitigation)?/gi;

export function stripHouseVoice(
  text: string,
  leaks: (t: string) => boolean,
): string {
  // Scan-driven rather than phrase-driven. The model has many ways to say the
  // same thing — "risk calibration", "risk profile", "safety calibrations",
  // "tier risk moderation" — and a regex per phrasing never converges. Instead:
  // propose a removal, then ask the scan whether the sentence is clean. A
  // candidate is only accepted if it fully clears, so nothing is left
  // half-edited, and a sentence that resists every attempt is returned
  // untouched for regeneration rather than mangled.
  // Split on runs of whitespace that CONTAIN a newline, keeping them, so the
  // paragraph structure survives. An earlier version joined every sentence
  // with a single space and silently flattened each combo into one block:
  // the leg heading ended up glued to the previous leg's last sentence.
  return text
    .split(/(\s*\n\s*)/)
    .map((chunk) => (/\n/.test(chunk) ? chunk : cleanBlock(chunk, leaks)))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanBlock(text: string, leaks: (t: string) => boolean): string {
  const tidy = (s: string) =>
    s.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;])/g, "$1").replace(/^[,;\s]+/, "").trim();
  const capitalise = (s: string) => (s && /[a-z]/.test(s[0]) ? s[0].toUpperCase() + s.slice(1) : s);
  return text
    .split(/(?<=\.)\s+/)
    .map((sentence) => {
      if (!leaks(sentence)) return sentence;

      // 1. Drop a leading adverbial clause: "Under VIP risk calibration, ..."
      const lead = sentence.match(/^[^,]{0,130},\s*/);
      if (lead) {
        const candidate = capitalise(tidy(sentence.slice(lead[0].length)));
        if (candidate && !leaks(candidate)) return candidate;
      }

      // 2. Drop a trailing/inline prepositional phrase: "... under Genius calibration."
      const cut = tidy(
        sentence.replace(
          /,?\s*\b(under|given|per|following|aligning with|in line with|in accordance with)\b[^.,]*/gi,
          "",
        ),
      );
      const candidate2 = capitalise(cut.endsWith(".") ? cut : cut ? `${cut}.` : cut);
      if (candidate2 && candidate2 !== "." && !leaks(candidate2)) return candidate2;

      // 3. Last resort: drop the sentence outright — but ONLY when it carries
      // no evidence of its own. A sentence with no digit in it is asserting a
      // house rule ("In accordance with Genius tier risk management, Double
      // Chance provides a well-supported hedge"), and deleting it costs the
      // reader nothing. A sentence containing figures is doing analytical work
      // even if it also name-drops a tier, so it is kept and reported instead.
      if (!/\d/.test(sentence)) return "";

      return sentence;
    })
    .filter((s) => s.length > 0)
    .join(" ");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../src/lib/prisma");
  const { scanDraftForInternalTerminology } = await import("../src/lib/houseVoice");

  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, reasoning: true },
  });

  const leaking = rows.filter((r) => scanDraftForInternalTerminology({ reasoning: r.reasoning }).length > 0);
  console.log(`published rows: ${rows.length}   leaking: ${leaking.length}\n`);

  let cleaned = 0;
  const stubborn: string[] = [];

  for (const r of leaking) {
    const next = stripHouseVoice(r.reasoning ?? "", (t) => scanDraftForInternalTerminology({ reasoning: t }).length > 0);
    const still = scanDraftForInternalTerminology({ reasoning: next });
    console.log(`--- ${r.id}`);
    console.log(`BEFORE: ${(r.reasoning ?? "").slice(0, 200)}`);
    console.log(`AFTER : ${next.slice(0, 200)}`);
    if (still.length > 0) {
      stubborn.push(r.id);
      console.log(`STILL LEAKING: ${still.map((s) => s.label).join(", ")}`);
    }
    console.log("");
    if (next !== r.reasoning) {
      cleaned++;
      if (apply && still.length === 0) {
        await prisma.prediction.update({ where: { id: r.id }, data: { reasoning: next } });
      }
    }
  }

  console.log(`rewritten: ${cleaned}   still leaking after rewrite: ${stubborn.length}`);
  if (stubborn.length) console.log(`  ${stubborn.join(", ")}\n  These are NOT written — they need regeneration.`);
  console.log(apply ? "APPLIED (only fully-clean rewrites were written)" : "DRY RUN — re-run with --apply to write");

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
