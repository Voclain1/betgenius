/** Offline only. Input contains exported first-decision snapshots joined to settlement, no credentials required. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  evaluateProspective,
  RELIABILITY_PROTOCOL,
  type ProspectiveObservation,
} from "../src/lib/reliabilityProtocol";
import {
  fitReliability,
  type ReliabilityRow,
} from "../src/lib/predictionReliability";
const [command, file, output] = process.argv.slice(2);
if (!file || !output || !["validation", "holdout", "fit"].includes(command))
  throw new Error(
    "Usage: tsx scripts/research-reliability.ts fit|validation|holdout input.json output.json",
  );
const bytes = readFileSync(file, "utf8");
const rows = JSON.parse(bytes) as ProspectiveObservation[];
if (!Array.isArray(rows) || rows.length > 100000)
  throw new Error("Expected bounded observation array (max 100000)");
const now = new Date();
if (command === "fit") {
  const cutoff = new Date(RELIABILITY_PROTOCOL.validationStart);
  if (now < cutoff) throw new Error("Development collection has not finished");
  const training: ReliabilityRow[] = rows
    .filter(
      (r) =>
        r.kickoff >= RELIABILITY_PROTOCOL.developmentStart &&
        r.kickoff < RELIABILITY_PROTOCOL.validationStart &&
        ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(
          r.market,
        ) &&
        (r.outcome === "WON" || r.outcome === "LOST") &&
        r.settledAt != null,
    )
    .map((r) => ({
      id: r.id,
      fixture: r.fixture,
      market: r.market,
      competition: r.competition ?? null,
      decisionAt: new Date(r.decisionAt),
      kickoff: new Date(r.kickoff),
      settledAt: new Date(r.settledAt!),
      raw: r.rawConfidence / 100,
      outcome: r.outcome === "WON" ? 1 : 0,
    }));
  writeFileSync(
    output,
    JSON.stringify(
      {
        model: fitReliability(training, cutoff, "s06-bins-20270101-v1"),
        activationAllowed: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
} else {
  const result = evaluateProspective(
    rows,
    now,
    command as "validation" | "holdout",
  );
  if (command === "holdout") {
    // One receipt per protocol, regardless of input filename. Preserve this directory in review evidence.
    mkdirSync("work/reliability-receipts", { recursive: true });
    writeFileSync(
      `work/reliability-receipts/${RELIABILITY_PROTOCOL.version}.json`,
      JSON.stringify({
        at: now.toISOString(),
        inputSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      { flag: "wx" },
    );
  }
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
}
console.log(`Wrote ${output}; no policy activation.`);
