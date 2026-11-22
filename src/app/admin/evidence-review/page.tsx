"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, FileQuestion } from "lucide-react";

type Reason = { code: string; detail: string };
type Side = { recentMatches: number; seasonStats: boolean; latestMatch: string | null; latestMatchAgeDays: number | null };
type Item = {
  id: string; fixture: string; league: string | null; status: string; categories: string[]; paid: boolean;
  market: string; pick: string; confidence: number; reasoning: string; matchPreview: string | null;
  kickoff: string | null; publishedAt: string | null; upcoming: boolean;
  classification: string; label: string; warning: string | null;
  evidence: { reasons: Reason[]; indicators: { generatedAt: string | null; contextCompleteFlag: boolean; home: Side; away: Side;
    h2hMeetings: number; standingsRowsForFixture: number; provenance: Record<string, string> | null; supersessionCheckable: boolean } };
  review: { kind: string; reason: string; at: string } | null;
  reassessment: { status: string; publicHold: boolean } | null;
  actions: { retain: boolean; openPrivateReview: boolean; rewriteDraft: boolean; reviewPage: boolean };
};
type Result = { items: Item[]; counts: Record<string, number>; scanned: number; truncated: boolean };

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
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams({ class: classes.join(","), paid, reviewed, timing, ...(status ? { status } : {}) });
    const res = await fetch("/api/admin/evidence-review?" + qs.toString());
    if (!res.ok) { setError("Could not load the review list."); return; }
    setData(await res.json());
  }, [classes, status, paid, reviewed, timing]);
  useEffect(() => { load(); }, [load]);

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
      </header>

      <section className="flex flex-wrap items-end gap-4 text-sm">
        <fieldset className="space-y-1">
          <legend className="text-xs uppercase tracking-wide text-gray-400">Classification</legend>
          <div className="flex flex-wrap gap-3">
            {CLASSES.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={classes.includes(c.id)}
                  onChange={(e) => setClasses(e.target.checked ? [...classes, c.id] : classes.filter((x) => x !== c.id))} />
                {c.label}{data?.counts[c.id] != null ? ` (${data.counts[c.id]})` : ""}
              </label>
            ))}
          </div>
        </fieldset>
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
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {data && (
        <p className="text-xs text-gray-400">
          {data.items.length} shown from the {data.scanned} most recent generated predictions{data.truncated ? " (narrow the filters to see older rows)" : ""}.
        </p>
      )}

      <ul className="space-y-6">
        {data?.items.map((item) => {
          const cls = CLASSES.find((c) => c.id === item.classification);
          const Icon = cls?.Icon ?? HelpCircle;
          return (
            <li key={item.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <Link href={`/admin/predictions/${item.id}`} className="text-lg font-semibold hover:underline">{item.fixture}</Link>
                  <p className="text-xs text-gray-400">
                    {item.league ?? "Unknown competition"} · kickoff {when(item.kickoff)} · {item.status}
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
      {data && data.items.length === 0 && <p className="text-sm text-gray-400">No predictions match these filters.</p>}
    </div>
  );
}
