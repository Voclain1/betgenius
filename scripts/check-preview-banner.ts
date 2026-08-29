/**
 * The "Preview data, not live" banner must NEVER render in production.
 *
 * It is a single env check, so the whole risk surface is that one comparison.
 * These assertions pin it: the banner appears on exactly one value and on
 * nothing else, including the values most likely to be confused with it.
 *
 * Read-only, no database. Run: npx tsx scripts/check-preview-banner.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
// The component's JSX compiles to React.createElement under tsx, which does
// not inject the automatic runtime the Next build uses.
(globalThis as any).React = react;

async function main() {
  const { PreviewDataBanner } = await import("../src/components/PreviewDataBanner");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const original = process.env.VERCEL_ENV;
  const rendersWith = (value: string | undefined) => {
    if (value === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = value;
    return PreviewDataBanner() !== null;
  };

  console.log("renders ONLY in preview:");
  check('VERCEL_ENV="preview" renders it', rendersWith("preview"));

  console.log("\nand in nothing else — production above all:");
  check('VERCEL_ENV="production" renders NOTHING', !rendersWith("production"));
  check('VERCEL_ENV="development" renders nothing', !rendersWith("development"));
  check("unset renders nothing (local next start, self-hosted)", !rendersWith(undefined));
  check('empty string renders nothing', !rendersWith(""));
  // Case and whitespace are the realistic ways a check like this gets fooled.
  check('"Preview" (capitalised) renders nothing', !rendersWith("Preview"));
  check('"PREVIEW" renders nothing', !rendersWith("PREVIEW"));
  check('" preview" (leading space) renders nothing', !rendersWith(" preview"));
  check('"preview-branch" renders nothing', !rendersWith("preview-branch"));
  check('"not-preview" renders nothing', !rendersWith("not-preview"));

  console.log("\nthe copy says what it needs to:");
  process.env.VERCEL_ENV = "preview";
  const el: any = PreviewDataBanner();
  const text = String(el?.props?.children ?? "");
  check("names itself as preview data", /Preview data, not live/i.test(text), text.slice(0, 60));
  check("says the content is seeded/demo", /seeded|demo/i.test(text));

  if (original === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original;

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
