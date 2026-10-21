/**
 * Failed-generation log (src/lib/generationFailures.ts): every failure of
 * generateAndPersistPrediction is recorded, grouped per match, closed by a
 * later success or a dismissal, and counted in the admin sidebar. Pure parts
 * run here; the wiring is checked by reading the source. No database.
 *
 * Run: npx tsx scripts/check-generation-failures.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generationSourceOf, failureFixtureKey, groupFailures, openFailureWhere } from "../src/lib/generationFailures";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

console.log("1. Source and match key");
const base = { home: "Inter", away: "Shakhtar Donetsk", league: "UEFA Champions League", kickoff: "2026-10-21T19:00:00Z" };
check("admin form: Manual", generationSourceOf({ ...base, manual: true }) === "Manual");
check("Goals pass: Goals", generationSourceOf({ ...base, intent: "GOALS" }) === "Goals");
check("VIP pass: VIP/Premium", generationSourceOf({ ...base, intent: "VIP_PREMIUM" }) === "VIP/Premium");
check("worker: Scheduled", generationSourceOf(base) === "Scheduled");
check("ids known: the matchKey", failureFixtureKey({ ...base, homeTeamApiId: 505, awayTeamApiId: 550 }) === "505-550-2026-10-21");
check("names only: names and day", failureFixtureKey({ ...base, home: " Inter ", away: "Shakhtar  Donetsk" }) === "inter|shakhtar donetsk|2026-10-21", failureFixtureKey({ ...base, home: " Inter ", away: "Shakhtar  Donetsk" }));

console.log("\n2. Grouping");
const row = (id: string, key: string, at: string) => ({
  id, fixtureKey: key, homeTeam: "A", awayTeam: "B", leagueName: null, kickoff: null, source: "Scheduled",
  reason: "r", detail: null, createdAt: new Date(at), resolvedAt: null, dismissedAt: null,
});
const groups = groupFailures([row("3", "k1", "2026-10-21T12:00:00Z"), row("2", "k2", "2026-10-21T11:00:00Z"), row("1", "k1", "2026-10-21T10:00:00Z")]);
check("one entry per match", groups.length === 2, groups.length);
check("latest failure's id and time lead; count and first time kept", groups[0].id === "3" && groups[0].failures === 2 && groups[0].firstAt.toISOString().startsWith("2026-10-21T10"), groups[0]);

console.log("\n3. Open means actionable");
const where = openFailureWhere(new Date("2026-10-21T12:00:00Z")) as any;
check("not resolved, not dismissed, kickoff ahead or unknown", where.resolvedAt === null && where.dismissedAt === null && JSON.stringify(where.OR).includes('"kickoff":null') && JSON.stringify(where.OR).includes("gt"));

console.log("\n4. Wiring");
const gen = read("src/lib/ai/generate.ts");
check("generateAndPersistPrediction logs every failure and rethrows", /catch \(err\) \{\s*await recordGenerationFailure\(rawInput, err\);\s*throw err;/.test(gen));
check("a success with picks resolves the match's open failures", /if \(first\) await resolveGenerationFailures\(rawInput,/.test(gen));
check("only the logged wrapper is exported", /export async function generateAndPersistPrediction/.test(gen) && /^async function generateUnlogged/m.test(gen));
const lib = read("src/lib/generationFailures.ts");
check("recording never throws", /catch \(logErr\) \{\s*console\.error/.test(lib));
const route = read("src/app/api/admin/generation-failures/[id]/route.ts");
check("retry runs the stored input as the admin's manual generation", /generateAndPersistPrediction\(\{ \.\.\.input, authorId: session!\.user\.id, manual: true \}\)/.test(route));
check("dismiss closes every open failure for the match", /where: \{ fixtureKey: failure\.fixtureKey, resolvedAt: null, dismissedAt: null \}/.test(route));
check("admin only", /if \(!isAdmin\(session\?\.user\.role\)\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/.test(route));
const layout = read("src/app/admin/layout.tsx");
check("sidebar links the page and shows the open count", /href: "\/admin\/failed-generations"/.test(layout) && /await openFailureCount\(\)/.test(layout));
const page = read("src/app/admin/failed-generations/page.tsx");
check("page: open with actions, kicked off, resolved or dismissed", /Needs attention/.test(page) && /Kicked off before it was fixed/.test(page) && /Resolved or dismissed this week/.test(page) && /<FailureActions id=\{g\.id\} \/>/.test(page));
check("page keeps provider names out", /gemini\|groq/.test(page));
const schema = read("prisma/schema.prisma");
check("schema declares GenerationFailure", /model GenerationFailure \{/.test(schema));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll generation failure checks passed");
