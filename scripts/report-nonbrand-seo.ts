import { readFileSync } from "node:fs";
import { nonbrandReport, compareNonbrandSnapshots, type GscSnapshot } from "./lib/nonbrandSeoReport";

function load(path: string): GscSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as GscSnapshot;
}
const files = process.argv.slice(2);
if (files.length < 1 || files.length > 2) {
  console.error("Usage: npx tsx scripts/report-nonbrand-seo.ts <gsc-query-page.json> [next-window.json]");
  process.exit(1);
}
try {
  const first = load(files[0]);
  const report = files.length === 2 ? compareNonbrandSnapshots(first, load(files[1])) : nonbrandReport(first);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
