"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, FileQuestion } from "lucide-react";

type Reason = { code: string; detail: string };
type Side = { recentMatches: number; seasonStats: boolean; latestMatch: string | null; latestMatchAgeDays: number | null };
type Item = {
  id: string; fixture: string; league: string | null; status: string; categories: string[]; paid: boolean;
  market: string; pick: string; confidence: number; reasoning: string; matchPreview: string | null;
  kickoff: string | null; publishedAt: string | null; createdAt: string; upcoming: boolean;
  classification: string; label: string; warning: string | null;
  evidence: { reasons: Reason[]; indicators: { generatedAt: string | null; contextCompleteFlag: boolean; home: Side; away: Side;
    h2hMeetings: number; standingsRowsForFixture: number; provenance: Record<string, string> | null; supersessionCheckable: boolean } };
  review: { kind: string; reason: string; at: string } | null;
  reassessment: { status: string; publicHold: boolean } | null;
  actions: { retain: boolean; openPrivateReview: boolean; rewriteDraft: boolean; reviewPage: boolean };
};
type Page = { items: Item[]; nextCursor: string | null; exhausted: boolean; examined: number };
type Summary = { byClass: Record<string, number>; matching: number; generatedInScope: number; complete: boolean };

const CLASSES = [
  { id: "FRESHNESS_UNCERTAIN", label: "Freshness uncertain", Icon: HelpCircle, tone: "text-amber-300" },
  { id: "EVIDENCE_INSUFFICIENT", label: "Evidence insufficient", Icon: AlertTriangle, tone: "text-red-300" },
  { id: "SNAPSHOT_UNAVAILABLE", label: "Snapshot unavailable", Icon: FileQuestion, tone: "text-gray-300" },
  { id: "EVIDENCE_AVAILABLE", label: "Evidence available", Icon: CheckCircle2, tone: "text-emerald-300" },
] as const;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—";
const sideText = (s: Side) => [
  `${s.recentMatches} recent result${s.recentMatches === 1 ? "" : "s"}`,
  s.seasonStats ? "season stats" : "no season stats",
  s.latestMatch ? `latest ${s.latestMatch.slice(0, 10)}${s.latestMatchAgeDays != null ? ` (${s.latestMatchAgeDays}d before generation)` : ""}` : null,
].filter(Boolean).join(" · ");

function Actions({ item, onDone }: { item: Item; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "RETAIN" | "OPEN_PRIVATE_REVIEW") {
    if (note.trim().length < 10) { setMessage("Add a review note of at least 10 characters."); return; }
    if (action === "OPEN_PRIVATE_REVIEW" && !window.confirm("Open a private reassessment review for this published pick? Nothing public changes; rewrite and withdrawal stay explicit decisions on the reassessment page.")) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/admin/evidence-review", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ predictionId: item.id, action, note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Action failed");
      setMessage(action === "RETAIN" ? "Recorded: retained unchanged." : "Private review opened. Continue on the reassessment page.");
      onDone();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400}
        placeholder="Review note (what you checked and why)" className="block w-full rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className="btn btn-ghost" disabled={busy} onClick={() => act("RETAIN")}>Retain unchanged</button>
        {item.actions.openPrivateReview && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => act("OPEN_PRIVATE_REVIEW")}>Open private review (rewrite / withdraw)</button>
        )}
        {item.actions.reviewPage && <Link className="underline text-gray-300 hover:text-white" href="/admin/reassessment">Continue on reassessment page →</Link>}
        {item.actions.rewriteDraft && <Link className="underline text-gray-300 hover:text-white" href={`/admin/predictions/${item.id}`}>Rewrite draft on prediction page →</Link>}
        {!item.upcoming && item.status === "PUBLISHED" && <span className="text-xs text-gray-400">Match started: retain or annotate only. Settled picks are never rewritten.</span>}
      </div>
      {message && <p className="text-xs text-gray-300">{message}</p>}
    </div>
  );
}

export default function EvidenceReviewPage() {
  const [classes, setClasses] = useState<string[]>(["FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"]);
  const [status, setStatus] = useState("");
  const [paid, setPaid] = useState("all");
  const [reviewed, setReviewed] = useState("unreviewed");
  const [timing, setTiming] = useState("all");
  // Creation scope. "30" here is exactly `npm run diagnose:missing-evidence -- --days=30`.
  const [days, setDays] = useState("30");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [kickoffFrom, setKickoffFrom] = useState("");
  const [kickoffTo, setKickoffTo] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = useCallback(() => {
    const qs = new URLSearchParams({ class: classes.join(","), paid, reviewed, timing });
    if (status) qs.set("status", status);
    if (days !== "all" && !createdFrom && !createdTo) qs.set("days", days);
    if (createdFrom) qs.set("createdFrom", createdFrom);
    if (createdTo) qs.set("createdTo", createdTo);
    if (kickoffFrom) qs.set("kickoffFrom", kickoffFrom);
    if (kickoffTo) qs.set("kickoffTo", kickoffTo);
    return qs;
  }, [classes, status, paid, reviewed, timing, days, createdFrom, createdTo, kickoffFrom, kickoffTo]);

  const load = useCallback(async () => {
    setError(""); setLoading(true);
    try {
      const qs = params();
      const [pageRes, sumRes] = await Promise.all([
        fetch("/api/admin/evidence-review?" + qs.toString()),
        fetch("/api/admin/evidence-review?" + qs.toString() + "&summary=1"),
      ]);
      if (!pageRes.ok || !sumRes.ok) throw new Error("Could not load the review list.");
      const page = (await pageRes.json()) as Page;
      setItems(page.items); setNext(page.nextCursor); setExhausted(page.exhausted);
      setSummary((await sumRes.json()) as Summary);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [params]);
  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    try {
      const qs = params(); qs.set("cursor", next);
      const res = await fetch("/api/admin/evidence-review?" + qs.toString());
      if (!res.ok) throw new Error("Could not load more.");
      const page = (await res.json()) as Page;
      setItems((prev) => [...prev, ...page.items]); setNext(page.nextCursor); setExhausted(page.exhausted);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }

  const scopeText = createdFrom || createdTo
    ? `generated ${createdFrom || "…"} to ${createdTo || "…"}`
    : days === "all" ? "generated at any time" : `generated in the last ${days} days`;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Evidence review</h1>
        <p className="max-w-3xl text-sm text-gray-400">
          Generated predictions whose saved football evidence was missing, could not be reconstructed, or whose freshness needs
          verification. A flag is a request to verify, not a finding that the pick is wrong. Nothing here changes a prediction:
          retaining records your decision privately, and rewrites or withdrawals continue through their existing approval steps.
          Visible to administrators only.
        </p>
        <p className="max-w-3xl text-xs text-gray-500">
          &ldquo;Evidence available&rdquo; describes coverage: football evidence was saved for both teams and was current when the pick
          was written. It is not an independent check of every statement in the reasoning.
        </p>
      </header>

      <section className="space-y-4 text-sm">
        <fieldset className="space-y-1">
          <legend className="text-xs uppercase tracking-wide text-gray-400">Classification</legend>
          <div className="flex flex-wrap gap-3">
            {CLASSES.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={classes.includes(c.id)}
                  onChange={(e) => setClasses(e.target.checked ? [...classes, c.id] : classes.filter((x) => x !== c.id))} />
                {c.label}{summary ? ` (${summary.byClass[c.id] ?? 0})` : ""}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Generated</span>
            <select className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={days} onChange={(e) => setDays(e.target.value)} disabled={!!(createdFrom || createdTo)}>
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
              <option value="365">Last 365 days</option><option value="all">Any time</option>
            </select></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Generated from</span>
            <input type="date" className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Generated to</span>
            <input type="date" className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Kickoff from</span>
            <input type="date" className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={kickoffFrom} onChange={(e) => setKickoffFrom(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Kickoff to</span>
            <input type="date" className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={kickoffTo} onChange={(e) => setKickoffTo(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Status</span>
            <select className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="PUBLISHED">Published</option><option value="PENDING_REVIEW">Pending review</option>
              <option value="DRAFT">Draft (held)</option><option value="ARCHIVED">Archived</option>
            </select></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Tier</span>
            <select className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={paid} onChange={(e) => setPaid(e.target.value)}>
              <option value="all">All</option><option value="paid">VIP / Premium</option><option value="free">Free</option>
            </select></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Kickoff</span>
            <select className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={timing} onChange={(e) => setTiming(e.target.value)}>
              <option value="all">All</option><option value="upcoming">Upcoming</option><option value="past">Played</option>
            </select></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wide text-gray-400">Review</span>
            <select className="block rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" value={reviewed} onChange={(e) => setReviewed(e.target.value)}>
              <option value="unreviewed">Not yet reviewed</option><option value="reviewed">Reviewed</option><option value="all">All</option>
            </select></label>
        </div>
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {summary && (
        <p className="text-xs text-gray-400">
          {summary.matching} matching predictions across {summary.generatedInScope} {scopeText}
          {summary.complete ? " (counts cover the full scope)" : " (counts cover the first 20,000 rows of this scope; narrow the dates for complete counts)"}.
          Showing {items.length}{exhausted ? "" : " so far"}.
        </p>
      )}
      <ul className="space-y-6">
        {items.map((item) => {
          const cls = CLASSES.find((c) => c.id === item.classification);
          const Icon = cls?.Icon ?? HelpCircle;
          return (
            <li key={item.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <Link href={`/admin/predictions/${item.id}`} className="text-lg font-semibold hover:underline">{item.fixture}</Link>
                  <p className="text-xs text-gray-400">
                    {item.league ?? "Unknown competition"} · kickoff {when(item.kickoff)} · generated {when(item.createdAt)} · {item.status}
                    {item.publishedAt ? ` · published ${when(item.publishedAt)}` : ""} · {item.categories.join(", ")}{item.paid ? " · paid" : ""}
                  </p>
                </div>
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${cls?.tone ?? ""}`}><Icon size={16} />{item.label}</p>
              </div>
              <p className="text-sm"><span className="text-gray-400">Selection:</span> {item.market}: <b>{item.pick}</b> · {item.confidence}% confidence</p>
              {item.warning && <p className="text-sm text-gray-200">{item.warning}</p>}
              {item.evidence.reasons.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
                  {item.evidence.reasons.map((r) => <li key={r.code}>{r.detail}</li>)}
                </ul>
              )}
              <dl className="grid gap-x-6 gap-y-1 text-xs text-gray-400 sm:grid-cols-2">
                <div><dt className="inline">Home: </dt><dd className="inline">{sideText(item.evidence.indicators.home)}</dd></div>
                <div><dt className="inline">Away: </dt><dd className="inline">{sideText(item.evidence.indicators.away)}</dd></div>
                <div><dt className="inline">Head-to-head meetings: </dt><dd className="inline">{item.evidence.indicators.h2hMeetings}</dd></div>
                <div><dt className="inline">Played table rows: </dt><dd className="inline">{item.evidence.indicators.standingsRowsForFixture}</dd></div>
                <div><dt className="inline">Generated: </dt><dd className="inline">{when(item.evidence.indicators.generatedAt)}</dd></div>
                <div><dt className="inline">Freshness record: </dt><dd className="inline">{item.evidence.indicators.provenance
                  ? Object.entries(item.evidence.indicators.provenance).map(([k, v]) => `${k} ${v}`).join(", ")
                  : "not recorded (generated before 22 Nov 2026)"}{item.evidence.indicators.supersessionCheckable ? "" : "; missed-match check unavailable before 19 Nov 2026"}</dd></div>
              </dl>
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-300">Original reasoning</summary>
                {item.matchPreview && <p className="mt-2 whitespace-pre-line text-gray-300">{item.matchPreview}</p>}
                <p className="mt-2 whitespace-pre-line text-gray-300">{item.reasoning}</p>
              </details>
              {item.review && (
                <p className="text-xs text-gray-400">
                  {item.review.kind === "EVIDENCE_REVIEW_RETAINED" ? "Retained unchanged" : "Private review opened"} on {when(item.review.at)}: {item.review.reason}
                </p>
              )}
              <Actions item={item} onDone={load} />
            </li>
          );
        })}
      </ul>
      {!loading && items.length === 0 && <p className="text-sm text-gray-400">No predictions match these filters.</p>}
      {next && !exhausted && (
        <button className="btn btn-ghost" disabled={loading} onClick={loadMore}>{loading ? "Loading…" : "Load more"}</button>
      )}
    </div>
  );
}
