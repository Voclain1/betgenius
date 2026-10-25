/**
 * House banners and the top banner slot (src/lib/houseBanners.ts,
 * src/components/ads/TopBanner.tsx). Pure rules run here; the wiring is
 * checked by reading the source. No database.
 *
 * Run: npx tsx scripts/check-house-banners.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sniffImageType, isSafeLinkUrl, isLiveBanner, bannerStatus, pickBanner, liveBannersWhere } from "../src/lib/houseBanners";
import { AD_FREE_ROUTES } from "../src/lib/ads";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

console.log("1. Uploads");
check("PNG recognised", sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) === "image/png");
check("JPEG recognised", sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)) === "image/jpeg");
check("GIF recognised", sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)) === "image/gif");
check("WebP recognised", sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)) === "image/webp");
check("SVG refused (it can carry script)", sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) === null);
check("https link accepted", isSafeLinkUrl("https://betgenius.ng/pricing"));
check("javascript: link refused", !isSafeLinkUrl("javascript:alert(1)"));
check("relative link refused", !isSafeLinkUrl("/pricing"));

console.log("\n2. When a banner shows");
const now = new Date("2026-10-25T12:00:00Z");
const d = (s: string) => new Date(s);
check("on, no dates: live", isLiveBanner({ active: true, startsAt: null, endsAt: null }, now) && bannerStatus({ active: true, startsAt: null, endsAt: null }, now) === "Live");
check("off: not shown", !isLiveBanner({ active: false, startsAt: null, endsAt: null }, now) && bannerStatus({ active: false, startsAt: null, endsAt: null }, now) === "Off");
check("starts tomorrow: scheduled", !isLiveBanner({ active: true, startsAt: d("2026-10-26T00:00:00Z"), endsAt: null }, now) && bannerStatus({ active: true, startsAt: d("2026-10-26T00:00:00Z"), endsAt: null }, now) === "Scheduled");
check("ended yesterday: ended", !isLiveBanner({ active: true, startsAt: null, endsAt: d("2026-10-24T00:00:00Z") }, now) && bannerStatus({ active: true, startsAt: null, endsAt: d("2026-10-24T00:00:00Z") }, now) === "Ended");
const where = JSON.stringify(liveBannersWhere(now));
check("the query applies the same rule", where.includes('"active":true') && where.includes('"startsAt":null') && where.includes('"endsAt":null'));
check("one banner per view, from the live ones", pickBanner(["a", "b", "c"], () => 0.99) === "c" && pickBanner(["a", "b"], () => 0) === "a" && pickBanner([], () => 0) === null);

console.log("\n3. The slot");
const slot = read("src/components/ads/TopBanner.tsx");
check("one fixed box whatever fills it (16:5 phone, 728x90 desktop)", /aspect-\[16\/5\] w-full max-w-\[400px\]/.test(slot) && /md:h-\[90px\] md:w-\[728px\]/.test(slot));
check("falls back to the network leaderboard pair", /<AdFrame id="leaderboard" \/>/.test(slot) && /<AdFrame id="mobileBanner" \/>/.test(slot));
check("paid banners carry the Ad tag and rel=sponsored", /labelled && <AdLabel \/>/.test(slot) && /"sponsored noopener"/.test(slot));
check("clicks pass through the counting route", /href=\{`\/api\/banners\/\$\{banner\.id\}\/click`\}/.test(slot));
check("a view is counted once, when half on screen", /threshold: 0\.5/.test(slot) && /sendBeacon/.test(slot));
check("the fold tab sits in the flow, not over the page", !/absolute -bottom/.test(slot) && /aria-expanded=\{!folded\}/.test(slot));

console.log("\n4. Placement");
const mounts = [
  "src/app/(public)/page.tsx",
  "src/app/(public)/predictions/layout.tsx",
  "src/app/(public)/fixtures/layout.tsx",
  "src/app/(public)/livescores/layout.tsx",
  "src/app/(public)/standings/layout.tsx",
  "src/app/(public)/statspad/layout.tsx",
  "src/app/(public)/guides/[slug]/page.tsx",
];
for (const m of mounts) check(`${m} shows the top banner`, /<TopBanner \/>/.test(read(m)));
check("never in the public layout (ad-free pages share it)", !/TopBanner/.test(read("src/app/(public)/layout.tsx")));
check("ad-free routes still listed", AD_FREE_ROUTES.length > 10);

console.log("\n5. Routes");
const click = read("src/app/api/banners/[id]/click/route.ts");
check("click redirects only to a safe link", /isSafeLinkUrl\(b\.linkUrl\) \? b\.linkUrl : home/.test(click));
const list = read("src/app/api/banners/route.ts");
check("the live list is cached at the edge for a minute", /s-maxage=60/.test(list) && /liveBannersWhere\(\)/.test(list));
const image = read("src/app/api/banners/[id]/image/route.ts");
check("images are cached for a year, keyed by version", /max-age=31536000, immutable/.test(image) && /nosniff/.test(image));
const admin = read("src/app/api/admin/banners/route.ts");
check("uploads: admin only, type sniffed, size capped", /isAdmin\(session\?\.user\.role\)/.test(admin) && /sniffImageType\(bytes\)/.test(admin) && /BANNER_MAX_BYTES/.test(admin));
const adminId = read("src/app/api/admin/banners/[id]/route.ts");
check("edit and delete: admin only", (adminId.match(/isAdmin\(session\?\.user\.role\)/g) ?? []).length === 2);
check("admin sidebar links the page", /href: "\/admin\/banners"/.test(read("src/app/admin/layout.tsx")));
check("schema declares HouseBanner", /model HouseBanner \{/.test(read("prisma/schema.prisma")));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll house banner checks passed");
