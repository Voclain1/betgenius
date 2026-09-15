/**
 * Crawl submitted production URLs and report metadata quality by template.
 * Character thresholds are review flags, not automatic failures: search
 * engines truncate by rendered width and may rewrite snippets.
 *
 * Run:
 *   node scripts/audit-production-metadata.mjs
 *   node scripts/audit-production-metadata.mjs --limit=200
 *   node scripts/audit-production-metadata.mjs --json=artifacts/seo-metadata.json
 */

import { writeFile } from "node:fs/promises";

const DEFAULT_ORIGIN = "https://www.betgenius.ng";
const CONCURRENCY = 15;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1]));
}

function first(html, patterns) {
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeEntities(value.replace(/\s+/g, " ").trim());
  }
  return "";
}

function pageText(html) {
  return decodeEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function template(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "home";
  if (parts[0] !== "predictions") return parts[0];
  if (parts.length === 1) return "predictions-root";
  if (["league", "cup", "team", "match", "h2h"].includes(parts[1])) return parts[1];
  return "prediction-feed";
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
        headers: { "user-agent": "BetGenius-metadata-audit/1.0" },
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

async function submittedUrls(origin) {
  const rootUrl = new URL("/sitemap.xml", origin).href;
  const root = await fetchText(rootUrl);
  if (!root.response.ok) throw new Error(`Sitemap returned ${root.response.status}: ${rootUrl}`);
  const discovered = locs(root.body);
  if (!/<sitemapindex\b/i.test(root.body)) return discovered;
  const children = await Promise.all(discovered.map(async (url) => {
    const child = await fetchText(url);
    if (!child.response.ok) throw new Error(`Child sitemap returned ${child.response.status}: ${url}`);
    return locs(child.body);
  }));
  return children.flat();
}

const origin = new URL(arg("origin") ?? DEFAULT_ORIGIN).origin;
const allUrls = await submittedUrls(origin);
const requestedLimit = Number(arg("limit") ?? "0");
const urls = Number.isFinite(requestedLimit) && requestedLimit > 0 ? allUrls.slice(0, requestedLimit) : allUrls;
const pages = new Array(urls.length);
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= urls.length) return;
    const url = urls[index];
    try {
      const { response, body } = await fetchText(url);
      const title = first(body, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
      const description = first(body, [
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i,
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
      ]);
      const canonical = first(body, [
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i,
        /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i,
      ]);
      const robots = first(body, [
        /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)/i,
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i,
      ]);
      const text = pageText(body);
      pages[index] = {
        url,
        template: template(url),
        status: response.status,
        finalUrl: response.url,
        title,
        titleLength: title.length,
        description,
        descriptionLength: description.length,
        canonical,
        robots,
        h1Count: [...body.matchAll(/<h1\b/gi)].length,
        words: text ? text.split(" ").length : 0,
      };
    } catch (error) {
      pages[index] = { url, template: template(url), error: error instanceof Error ? error.message : String(error) };
    }
    if ((index + 1) % 250 === 0) console.log(`Audited ${index + 1}/${urls.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()));

function duplicates(key) {
  const grouped = Object.groupBy(pages.filter((page) => page?.[key]), (page) => page[key]);
  return Object.entries(grouped)
    .filter(([, rows]) => rows.length > 1)
    .map(([value, rows]) => ({ value, count: rows.length, urls: rows.map((row) => row.url) }))
    .sort((a, b) => b.count - a.count);
}

function summary(rows) {
  const successful = rows.filter((row) => row?.status === 200);
  const sortedWords = successful.map((row) => row.words).sort((a, b) => a - b);
  return {
    urls: rows.length,
    requestErrors: rows.filter((row) => row?.error).length,
    non200: rows.filter((row) => row?.status && row.status !== 200).length,
    missingTitle: successful.filter((row) => !row.title).length,
    titleOver60: successful.filter((row) => row.titleLength > 60).length,
    missingDescription: successful.filter((row) => !row.description).length,
    descriptionOver160: successful.filter((row) => row.descriptionLength > 160).length,
    badH1: successful.filter((row) => row.h1Count !== 1).length,
    thinUnder200: successful.filter((row) => row.words < 200).length,
    medianWords: sortedWords.length ? sortedWords[Math.floor(sortedWords.length / 2)] : 0,
  };
}

const byTemplate = Object.fromEntries(
  Object.entries(Object.groupBy(pages, (page) => page.template)).map(([name, rows]) => [name, summary(rows)]),
);
const report = {
  auditedAt: new Date().toISOString(),
  origin,
  submittedUrls: allUrls.length,
  auditedUrls: pages.length,
  totals: summary(pages),
  duplicateTitles: duplicates("title"),
  duplicateDescriptions: duplicates("description"),
  byTemplate,
  flaggedPages: pages.filter((page) => page?.error || page?.status !== 200 || !page?.title || !page?.description || page?.h1Count !== 1 || page?.words < 200),
};

console.log("\n" + JSON.stringify({
  submittedUrls: report.submittedUrls,
  auditedUrls: report.auditedUrls,
  totals: report.totals,
  duplicateTitleGroups: report.duplicateTitles.length,
  duplicateDescriptionGroups: report.duplicateDescriptions.length,
  byTemplate: report.byTemplate,
}, null, 2));

const jsonPath = arg("json");
if (jsonPath) {
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report written to ${jsonPath}`);
}

if (report.totals.requestErrors || report.totals.non200 || report.totals.missingTitle || report.totals.missingDescription || report.totals.badH1) {
  process.exitCode = 1;
}
