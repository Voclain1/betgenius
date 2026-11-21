/**
 * Read-only Search Console report for queries grouped with their actual
 * ranking page. Deliberately excludes brand-ambiguous "genius" searches from
 * the non-branded bucket and avoids treating top-row exports as full GSC totals.
 * No Google credentials, live calls or paid keyword API.
 */
export type GscRow = {
  keys: [string, string]; // [query, absolute canonical page URL]
  clicks: number;
  impressions: number;
  position: number;
};
export type GscSnapshot = {
  startDate: string;
  endDate: string;
  dimensions: ["query", "page"];
  sample: boolean;
  source: string;
  rows: GscRow[];
};

export type QueryKind = "branded" | "ambiguous" | "nonbranded";
export type SearchStats = { impressions: number; clicks: number; ctr: number; position: number | null };
export type PageStats = SearchStats & { page: string; rowCount: number };
export type QueryOpportunity = SearchStats & { query: string; page: string };
export type NonbrandReport = {
  window: { startDate: string; endDate: string };
  sample: boolean;
  rowsReviewed: number;
  categories: Record<QueryKind, SearchStats>;
  pages: PageStats[];
  opportunities: QueryOpportunity[];
  limitations: string[];
};
const kinds: QueryKind[] = ["branded", "ambiguous", "nonbranded"];
const round = (v: number) => Math.round(v * 10000) / 10000;
export function classifySearchQuery(query: string): QueryKind {
  const q = query.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
  if (/bet[\s._-]*geni(?:us|uss|uus)|betgenuis|betgeniuss/.test(q)) return "branded";
  if (/\b(genius|genuis|geniuss)\b/.test(q)) return "ambiguous";
  return "nonbranded";
}
function statsOf(rows: GscRow[]): SearchStats {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  return {
    impressions,
    clicks,
    ctr: impressions ? round(clicks / impressions) : 0,
    position: impressions ? round(rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions) : null,
  };
}
function safeDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
  return timestamp;
}
function validate(s: GscSnapshot): void {
  if (!s || s.dimensions?.[0] !== "query" || s.dimensions?.[1] !== "page" || s.dimensions.length !== 2) {
    throw new Error("Expected GSC query + page dimensions; do not sum page-only and query-only exports.");
  }
  if (typeof s.sample !== "boolean" || !s.source || !Array.isArray(s.rows)) throw new Error("Snapshot needs source, sample flag and rows.");
  if (safeDate(s.endDate) < safeDate(s.startDate)) throw new Error("End date precedes start date.");
  const seen = new Set<string>();
  for (const row of s.rows) {
    if (!Array.isArray(row.keys) || row.keys.length !== 2 || !row.keys[0]?.trim()) throw new Error("Every row needs query and page.");
    let page: URL;
    try { page = new URL(row.keys[1]); } catch { throw new Error("Page is not an absolute URL."); }
    if (page.origin !== "https://www.betgenius.ng") throw new Error("Page is not on the canonical BetGenius origin.");
    if (![row.clicks, row.impressions, row.position].every(Number.isFinite) ||
        row.clicks < 0 || row.impressions < 0 || row.clicks > row.impressions || row.position < 1) {
      throw new Error("GSC clicks, impressions or position are invalid.");
    }
    const key = JSON.stringify(row.keys.map((v) => v.toLowerCase()));
    if (seen.has(key)) throw new Error("Duplicate query-page row would inflate impressions.");
    seen.add(key);
  }
}
export function nonbrandReport(snapshot: GscSnapshot): NonbrandReport {
  validate(snapshot);
  const grouped: Record<QueryKind, GscRow[]> = { branded: [], ambiguous: [], nonbranded: [] };
  for (const row of snapshot.rows) grouped[classifySearchQuery(row.keys[0])].push(row);
  const pages = new Map<string, GscRow[]>();
  for (const row of grouped.nonbranded) {
    const page = new URL(row.keys[1]).pathname;
    pages.set(page, [...(pages.get(page) ?? []), row]);
  }
  const summaries = [...pages.entries()].map(([page, rows]) => ({
    page, rowCount: rows.length, ...statsOf(rows),
  })).sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
  const opportunities = grouped.nonbranded
    .filter((r) => r.impressions >= 20 && r.position >= 4 && r.position <= 20 && r.clicks / r.impressions < 0.08)
    .map((r) => ({ query: r.keys[0], page: new URL(r.keys[1]).pathname, ...statsOf([r]) }))
    .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  const categories = Object.fromEntries(kinds.map((kind) => [kind, statsOf(grouped[kind])])) as Record<QueryKind, SearchStats>;
  return {
    window: { startDate: snapshot.startDate, endDate: snapshot.endDate },
    sample: snapshot.sample,
    rowsReviewed: snapshot.rows.length,
    categories, pages: summaries, opportunities,
    limitations: [
      "GSC hides some queries and may cap exported rows; these are not complete non-branded site totals.",
      "Mean position is impression-weighted over these query-page rows, not a rank for every search.",
      "The opportunity list is a review queue (>=20 impressions, positions 4-20, CTR below 8%), not a click forecast.",
      ...(snapshot.sample ? ["This file contains hand-selected verified examples, so no period-over-period performance claim is permitted."] : []),
    ],
  };
}
/** Refuse false 'improvement' claims from hand-selected examples or unequal windows. */
export function compareNonbrandSnapshots(before: GscSnapshot, after: GscSnapshot): {
  comparable: boolean; reason: string;
  before: NonbrandReport; after: NonbrandReport;
} {
  const first = nonbrandReport(before), second = nonbrandReport(after);
  if (before.sample || after.sample) return { comparable: false, reason: "Selected samples cannot establish a search-traffic trend.", before: first, after: second };
  const daysA = (safeDate(before.endDate) - safeDate(before.startDate)) / 86400000 + 1;
  const daysB = (safeDate(after.endDate) - safeDate(after.startDate)) / 86400000 + 1;
  if (daysA !== daysB) return { comparable: false, reason: "Reporting windows have different durations.", before: first, after: second };
  if (safeDate(after.startDate) <= safeDate(before.endDate)) return { comparable: false, reason: "Reporting windows overlap.", before: first, after: second };
  return { comparable: true, reason: "Directional query-page comparison only: anonymized/unreported queries remain excluded.", before: first, after: second };
}
