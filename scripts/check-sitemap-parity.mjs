/**
 * Production sitemap parity check.
 *
 * Every submitted URL must resolve directly to an indexable HTML document and
 * identify itself as canonical. Supports both the current urlset and a future
 * sitemap index, so the same release gate survives sitemap segmentation.
 *
 * Run:
 *   node scripts/check-sitemap-parity.mjs
 *   node scripts/check-sitemap-parity.mjs --limit=100
 *   node scripts/check-sitemap-parity.mjs --origin=https://preview.example
 */

const DEFAULT_ORIGIN = "https://www.betgenius.ng";
const CONCURRENCY = 15;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function absolute(value, base) {
  return new URL(value, base).href;
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeXml(match[1]));
}

function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["']`, "i"))?.[1] ??
    ""
  );
}

function canonicalHref(html) {
  return (
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i)?.[1] ??
    ""
  );
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "BetGenius-sitemap-parity/1.0" },
      });
      return { response, body: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function sitemapUrls(rootUrl) {
  const root = await fetchText(rootUrl);
  if (!root.response.ok) throw new Error(`Sitemap returned ${root.response.status}: ${rootUrl}`);
  const discovered = locs(root.body);
  if (!/<sitemapindex\b/i.test(root.body)) return discovered;

  const childLists = await Promise.all(
    discovered.map(async (child) => {
      const result = await fetchText(child);
      if (!result.response.ok) throw new Error(`Child sitemap returned ${result.response.status}: ${child}`);
      return locs(result.body);
    }),
  );
  return childLists.flat();
}

const origin = new URL(arg("origin") ?? DEFAULT_ORIGIN).origin;
const sitemap = absolute("/sitemap.xml", origin);
const requestedLimit = Number(arg("limit") ?? "0");
const allUrls = await sitemapUrls(sitemap);
const urls = Number.isFinite(requestedLimit) && requestedLimit > 0 ? allUrls.slice(0, requestedLimit) : allUrls;

const results = new Array(urls.length);
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= urls.length) return;
    const url = urls[index];
    try {
      const { response, body } = await fetchText(url);
      results[index] = {
        url,
        status: response.status,
        finalUrl: response.url,
        canonical: canonicalHref(body),
        robots: metaContent(body, "robots"),
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch (error) {
      results[index] = { url, error: error instanceof Error ? error.message : String(error) };
    }
    if ((index + 1) % 250 === 0) console.log(`Checked ${index + 1}/${urls.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()));

const failures = [];
for (const result of results) {
  if (result.error) failures.push({ reason: "request-error", result });
  else if (result.status !== 200) failures.push({ reason: `status-${result.status}`, result });
  else if (result.finalUrl !== result.url) failures.push({ reason: "redirect", result });
  else if (!result.contentType?.toLowerCase().includes("text/html")) failures.push({ reason: "non-html", result });
  else if (/\bnoindex\b/i.test(result.robots ?? "")) failures.push({ reason: "noindex", result });
  else if (!result.canonical) failures.push({ reason: "missing-canonical", result });
  else if (absolute(result.canonical, origin) !== result.url) failures.push({ reason: "canonical-mismatch", result });
}

console.log(`\nSitemap parity: ${urls.length - failures.length}/${urls.length} passed (${allUrls.length} total submitted URLs).`);
if (failures.length) {
  const counts = Object.entries(Object.groupBy(failures, (failure) => failure.reason))
    .map(([reason, rows]) => `${reason}: ${rows.length}`)
    .join(", ");
  console.error(`Failures: ${counts}`);
  for (const failure of failures.slice(0, 25)) console.error(`  ${failure.reason}: ${failure.result.url}`);
  if (failures.length > 25) console.error(`  ...and ${failures.length - 25} more`);
  process.exit(1);
}

console.log("All submitted URLs resolve directly to indexable, self-canonical HTML pages.");
