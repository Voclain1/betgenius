/**
 * Performance budgets (SEO-604): the pure half. How a page's first-load
 * JavaScript is assembled from the build manifest, and how it is judged
 * against the budgets in scripts/perf-budgets.json. No file system here, so
 * scripts/check-perf-budget-logic.ts can pin it inside `npm run preflight`;
 * scripts/check-performance-budget.ts applies it to a real `.next` build.
 */

export type AppBuildManifest = { pages: Record<string, string[]> };
export type Budgets = {
  /** Ceiling for every page's first-load JS, in KB gzipped. */
  defaultKb: number;
  /** Ceiling for the JS every page shares (the root layout and the framework), in KB gzipped. */
  sharedKb: number;
  /** Pages that legitimately need more, by manifest key ("/(public)/bet-builder/page"). */
  routes?: Record<string, number>;
};

/**
 * The JS a first visit to `pageKey` downloads: its own chunks plus those of
 * every layout above it ("/layout", "/(public)/layout", ...). The same set
 * Next.js reports as First Load JS. CSS is left out.
 */
export function firstLoadChunks(manifest: AppBuildManifest, pageKey: string): string[] {
  const segments = pageKey.split("/").slice(1, -1);
  const chunks = new Set<string>();
  for (let depth = 0; depth <= segments.length; depth++) {
    const layout = depth === 0 ? "/layout" : `/${[...segments.slice(0, depth), "layout"].join("/")}`;
    for (const c of manifest.pages[layout] ?? []) chunks.add(c);
  }
  for (const c of manifest.pages[pageKey] ?? []) chunks.add(c);
  return [...chunks].filter((c) => c.endsWith(".js")).sort();
}

/** Every page in the manifest (route handlers and layouts are not pages). */
export function pageKeys(manifest: AppBuildManifest): string[] {
  return Object.keys(manifest.pages).filter((k) => k.endsWith("/page")).sort();
}

export type BudgetRow = { page: string; kb: number; budgetKb: number; over: boolean };

/** Judge measured sizes (KB gzipped) against the budgets. */
export function evaluateBudgets(sizes: Record<string, number>, sharedKb: number, budgets: Budgets): { rows: BudgetRow[]; sharedOver: boolean; failures: string[] } {
  const rows = Object.entries(sizes)
    .map(([page, kb]) => {
      const budgetKb = budgets.routes?.[page] ?? budgets.defaultKb;
      return { page, kb, budgetKb, over: kb > budgetKb };
    })
    .sort((a, b) => b.kb - a.kb || a.page.localeCompare(b.page));
  const sharedOver = sharedKb > budgets.sharedKb;
  const failures = [
    ...(sharedOver ? [`shared JS ${sharedKb.toFixed(1)} KB > ${budgets.sharedKb} KB budget (every page pays this)`] : []),
    ...rows.filter((r) => r.over).map((r) => `${r.page}: ${r.kb.toFixed(1)} KB > ${r.budgetKb} KB budget`),
  ];
  // An override for a page that no longer exists is a stale budget, not a pass.
  for (const page of Object.keys(budgets.routes ?? {})) {
    if (!(page in sizes)) failures.push(`budget override for ${page}, which is not a page in this build`);
  }
  return { rows, sharedOver, failures };
}
