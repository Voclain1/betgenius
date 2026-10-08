/** TEMPORARY, read-only: which hosts do stored crest/logo URLs use? */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import { prisma } from "../src/lib/prisma";
async function main() {
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: not read-only");
  const rows = await prisma.$queryRawUnsafe<{ host: string; n: bigint }[]>(
    `SELECT substring("crestUrl" from '^https?://([^/]+)') AS host, count(*) AS n FROM "TeamEnrichmentCache" WHERE "crestUrl" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
  );
  console.log("TeamEnrichmentCache.crestUrl hosts:");
  for (const r of rows) console.log(`  ${r.host}  ${r.n}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
