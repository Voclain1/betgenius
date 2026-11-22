"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, HelpCircle, Lock, RefreshCw, X } from "lucide-react";

type Signal = { code: string; severity: string; source: string; message: string };
type TeamDiff = {
  side: string; team: string;
  newResults: Array<{ date: string; opponent: string; venue: string; result: string; score: string | null; competition: string | null }>;
  form: { before: string | null; after: string | null } | null;
  season: { before: Rec; after: Rec } | null;
  rank: { before: number | null; after: number | null } | null;
  newlyUnavailable: string[]; noLongerListed: string[];
  coach: { before: string; after: string } | null;
};
type Rec = { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number } | null;
type Diff = { teams: TeamDiff[]; newHeadToHead: number; changed: boolean } | null;
type Card = {
  id: string; fixture: string; league: string | null; kickoff: string | null; status: string; categories: string[]; paid: boolean;
  adminAuthored: boolean; upcoming: boolean;
  current: { market: string; pick: string; confidence: number; odds: number | null; publishedAt: string | null; provenance: string; reasoning: string; matchPreview: string | null };
  adminStatus: string; reasons: string[]; signals: Signal[]; summary: string | null; lastChecked: string | null;
  snapshot: { originalAt: string | null; latestAt: string | null; source: string };
  diff: Diff; possiblyStale: string[];
  draft: { revisionId: string; reasoning: string; matchPreview: string; confidence: number; sameSelection: boolean; stale: boolean; at: string } | null;
  decision: { required: boolean; reasons: string[] };
  latestDecision: { kind: string; reason: string; at: string } | null;
  suggestedNotes: { update: string; keep: string };
  actions: { reviewUpdate: boolean; approve: boolean; keep: boolean; withdraw: boolean; replace: boolean; editDraft: boolean };
};
type Counts = { newEvidence: number; needingApproval: number; awaitingDecision: number; needsMoreEvidence: number };
type Reviewed = { revisionId: string; kind: string; reason: string; at: string; predictionId: string; fixture: string; kickoff: string | null; status: string; pick: string; confidence: number };
type Flag = { id: string; fixture: string; league: string | null; kickoff: string | null; status: string; paid: boolean; market: string; pick: string; confidence: number;
  label: string; warning: string | null; evidence: { reasons: Array<{ code: string; detail: string }> } };

const FIELD = "block w-full rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200";
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT" : "—";
const recText = (r: Rec) => r ? `P${r.played} W${r.won} D${r.drawn} L${r.lost}, ${r.goalsFor}-${r.goalsAgainst}` : "none";
const KIND_LABEL: Record<string, string> = {
  CONFIRMED: "Kept original", ADMIN_REWRITE_APPLIED: "Explanation updated", WITHDRAWN: "Withdrawn", ADMIN_RESTORED: "Restored",
  EVIDENCE_REVIEW_RETAINED: "Evidence flag retained", EVIDENCE_REVIEW_OPENED: "Private review opened",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed");
  return payload;
}

function StatusLine({ status }: { status: string }) {
  const Icon = status === "Awaiting your decision" ? AlertTriangle : status === "Draft ready" ? FileText
    : status === "Match started (read-only)" ? Lock : status === "Needs more evidence" ? HelpCircle
    : status === "Retained" || status === "Updated by admin" ? CheckCircle2 : Clock;
  const tone = status === "Awaiting your decision" ? "text-amber-300" : status === "Draft ready" ? "text-emerald-300" : "text-gray-200";
  return <p className={`flex items-center gap-1.5 text-sm font-semibold ${tone}`}><Icon size={16} aria-hidden />{status}</p>;
}

function WhatChanged({ diff }: { diff: Diff }) {
  if (!diff) return <p className="text-sm text-gray-400">No saved comparison yet: the latest monitoring snapshot is not available.</p>;
  if (!diff.changed) return <p className="text-sm text-gray-400">No change in the saved football evidence.</p>;
  return (
    <ul className="space-y-1.5 text-sm text-gray-200">
      {diff.teams.flatMap((t) => [
        ...t.newResults.map((m) => <li key={t.side + m.date}>{t.team}: new result {m.result} {m.score ?? ""} {m.venue === "home" ? "vs" : "at"} {m.opponent} ({m.date})</li>),
        t.form ? <li key={t.side + "form"}>{t.team}: form {t.form.before ?? "—"} → {t.form.after ?? "—"}</li> : null,
        t.rank ? <li key={t.side + "rank"}>{t.team}: table position {t.rank.before ?? "—"} → {t.rank.after ?? "—"}</li> : null,
        t.season ? <li key={t.side + "season"}>{t.team}: season {recText(t.season.before)} → {recText(t.season.after)}</li> : null,
        ...t.newlyUnavailable.map((p) => <li key={t.side + "out" + p}>{t.team}: newly unavailable {p}</li>),
        t.noLongerListed.length ? <li key={t.side + "back"}>{t.team}: no longer listed as unavailable: {t.noLongerListed.join(", ")}</li> : null,
        t.coach ? <li key={t.side + "coach"}>{t.team}: head coach {t.coach.before} → {t.coach.after}</li> : null,
      ])}
      {diff.newHeadToHead > 0 && <li>{diff.newHeadToHead} new head-to-head meeting{diff.newHeadToHead === 1 ? "" : "s"}</li>}
    </ul>
  );
}

function ReviewModal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState(card.decision.required ? card.suggestedNotes.keep : card.suggestedNotes.update);
  const [draft, setDraft] = useState(card.draft && !card.draft.stale ? card.draft : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decision = card.decision.required || (draft ? (!draft.sameSelection || draft.confidence < card.current.confidence - 5) : false);
  async function run(fn: () => Promise<string>) {
    if (note.trim().length < 10) { setError("Add an audit note of at least 10 characters."); return; }
    setBusy(true); setError("");
    try { onDone(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function generate() {
    setBusy(true); setError("");
    try {
      const r = await post("/api/admin/reassessment/rewrite", { predictionId: card.id, action: "GENERATE", note: note.trim().length >= 10 ? note : card.suggestedNotes.update });
      setDraft({ revisionId: r.revisionId, reasoning: r.draft.reasoning, matchPreview: r.draft.matchPreview ?? "", confidence: r.draft.confidence,
        sameSelection: r.draft.sameSelection, stale: false, at: new Date().toISOString() });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={"Review update: " + card.fixture}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-brand-border bg-brand-card p-5 sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{card.fixture}</h2>
            <p className="text-xs text-gray-400">{when(card.kickoff)} · {card.current.market}: {card.current.pick} · {card.current.confidence}%{card.current.odds ? ` · ${card.current.odds.toFixed(2)}` : ""}</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">What changed</h3>
          <WhatChanged diff={card.diff} />
          {card.possiblyStale.length > 0 && (
            <div className="pt-1">
              <p className="text-xs uppercase tracking-wide text-gray-400">Statements that may now be out of date</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-300">{card.possiblyStale.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </section>

        {decision ? (
          <section className="mt-5 space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-300"><AlertTriangle size={16} aria-hidden />Decision required</p>
            <ul className="list-disc pl-5 text-sm text-gray-200">
              {[...card.decision.reasons, ...(draft && !draft.sameSelection ? ["The updated analysis points to a different selection"] : []),
                ...(draft && draft.confidence < card.current.confidence - 5 ? [`The updated analysis supports lower confidence (${draft.confidence}%)`] : [])]
                .filter((v, i, a) => a.indexOf(v) === i).map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="text-sm text-gray-400">An explanation-only update would hide this change behind new wording, so it is not offered. Keep the original, withdraw it, or use the qualified replacement on the reassessment page.</p>
          </section>
        ) : (
          <section className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-300">Published explanation (current)</h3>
              {card.current.matchPreview && <p className="mt-2 whitespace-pre-line text-sm text-gray-400">{card.current.matchPreview}</p>}
              <p className="mt-2 whitespace-pre-line text-sm text-gray-200">{card.current.reasoning}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-300">Suggested update (private)</h3>
              {draft ? (
                <>
                  {draft.matchPreview && <p className="mt-2 whitespace-pre-line text-sm text-gray-400">{draft.matchPreview}</p>}
                  <p className="mt-2 whitespace-pre-line text-sm text-gray-200">{draft.reasoning}</p>
                  <p className="mt-2 text-xs text-gray-400">Selection, confidence, odds, categories and publication time stay exactly as published.</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-400">No draft yet. Preparing one makes a single private model request; nothing is published.</p>
              )}
            </div>
          </section>
        )}

        <label className="mt-5 block text-xs uppercase tracking-wide text-gray-400">Audit note (saved privately)
          <textarea className={FIELD + " mt-1"} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!decision && !draft && card.actions.reviewUpdate && (
            <button className="btn btn-primary" disabled={busy} onClick={generate}>{busy ? "Preparing…" : "Prepare private draft"}</button>
          )}
          {!decision && draft && (
            <button className="btn btn-primary" disabled={busy}
              onClick={() => run(async () => { await post("/api/admin/reassessment/rewrite", { predictionId: card.id, action: "APPLY", note, revisionId: draft.revisionId }); return "Explanation updated. Selection, confidence and odds unchanged."; })}>
              Approve &amp; apply
            </button>
          )}
          {card.actions.keep && (
            <button className="btn btn-ghost" disabled={busy}
              onClick={() => run(async () => { await post("/api/admin/reassessment/resolve", { predictionId: card.id, action: "KEEP", note }); return "Original kept. A genuinely new change will reopen this case."; })}>
              Keep original
            </button>
          )}
          {decision && card.actions.withdraw && (
            <button className="btn btn-ghost" disabled={busy}
              onClick={() => { if (window.confirm("Withdraw this published pick? This is recorded and cannot be undone from here.")) run(async () => { await post("/api/admin/reassessment/resolve", { predictionId: card.id, action: "WITHDRAW", note }); return "Pick withdrawn."; }); }}>
              Withdraw
            </button>
          )}
          {decision && card.actions.replace && <Link className="btn btn-ghost text-center" href="/admin/reassessment">Qualified replacement…</Link>}
        </div>
      </div>
    </div>
  );
}

function UpdateCardView({ card, onReview, onDone }: { card: Card; onReview: () => void; onDone: (msg: string) => void }) {
  const [compare, setCompare] = useState<{ diff: Diff; possiblyStale: string[]; signals: Array<Signal & { reason: string }>; comparedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function runCompare() {
    setBusy(true);
    try { setCompare(await post("/api/admin/prediction-updates", { predictionId: card.id })); } catch (e) { onDone(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/predictions/${card.id}`} className="block truncate text-base font-semibold hover:underline">{card.fixture}</Link>
          <p className="text-xs text-gray-400">
            {when(card.kickoff)} · {card.paid ? "VIP / Premium" : "Free"} · {card.status === "PUBLISHED" ? "Published" : card.status === "PENDING_REVIEW" ? "Pending review" : card.status}
            {card.adminAuthored ? " · admin-authored" : ""}
          </p>
        </div>
        <StatusLine status={card.adminStatus} />
      </div>
      <p className="text-sm"><span className="text-gray-400">Current pick:</span> {card.current.market}: <b>{card.current.pick}</b> · {card.current.confidence}%{card.current.odds ? ` · ${card.current.odds.toFixed(2)}` : ""}</p>
      {card.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-200">{card.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {card.adminStatus === "Needs more evidence" && card.summary && <p className="text-sm text-gray-300">{card.summary}</p>}
      <p className="text-xs text-gray-500">Last checked {when(card.lastChecked)} · written from evidence of {when(card.snapshot.originalAt)}{card.snapshot.latestAt ? ` · latest snapshot ${when(card.snapshot.latestAt)}` : ""}</p>
      {compare && (
        <div className="space-y-1 text-sm">
          <p className="text-xs text-gray-400">Compared with current caches at {when(compare.comparedAt)} (no provider calls)</p>
          <WhatChanged diff={compare.diff} />
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {card.upcoming && card.status === "PUBLISHED" && card.adminStatus !== "Needs more evidence" && (card.actions.keep || card.actions.reviewUpdate) && (
          <button className="btn btn-primary" onClick={onReview}>{card.decision.required ? "Decide" : card.draft && !card.draft.stale ? "Review draft" : "Review update"}</button>
        )}
        {card.upcoming && card.status !== "PUBLISHED" && (
          <button className="btn btn-ghost" disabled={busy} onClick={runCompare}><RefreshCw size={14} className="mr-1 inline" aria-hidden />{busy ? "Comparing…" : "Compare with latest evidence"}</button>
        )}
        {card.actions.editDraft && <Link className="btn btn-ghost text-center" href={`/admin/predictions/${card.id}`}>Revise draft</Link>}
        {card.adminAuthored && card.upcoming && <span className="text-xs text-gray-400">Admin-authored pick: keep it or edit it on the prediction page. It is never re-worded automatically.</span>}
        {!card.upcoming && <span className="text-xs text-gray-400">Match started: read-only.</span>}
      </div>
    </li>
  );
}

export default function PredictionUpdatesPage() {
  const [tab, setTab] = useState<"new" | "needs" | "reviewed">("new");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Reviewed[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [flagNext, setFlagNext] = useState<string | null>(null);
  const [tier, setTier] = useState("all");
  const [status, setStatus] = useState("");
  const [kickoffFrom, setKickoffFrom] = useState("");
  const [kickoffTo, setKickoffTo] = useState("");
  const [open, setOpen] = useState<Card | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ tab, tier, ...extra });
    if (status) q.set("status", status);
    if (kickoffFrom) q.set("kickoffFrom", kickoffFrom);
    if (kickoffTo) q.set("kickoffTo", kickoffTo);
    return q.toString();
  }, [tab, tier, status, kickoffFrom, kickoffTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, page] = await Promise.all([
        fetch("/api/admin/prediction-updates?counts=1").then((r) => r.json()),
        fetch("/api/admin/prediction-updates?" + qs()).then((r) => r.json()),
      ]);
      setCounts(c);
      if (tab === "reviewed") { setReviewed(page.items ?? []); setNext(page.nextCursor ?? null); setCards([]); }
      else { setCards(page.cards ?? []); setTotal(page.total ?? 0); setNext(page.nextCursor ?? null); }
      if (tab === "needs") {
        const f = await fetch("/api/admin/evidence-review?reviewed=unreviewed&timing=upcoming&days=30&pageSize=10").then((r) => r.json());
        setFlags(f.items ?? []); setFlagNext(f.nextCursor ?? null);
      }
    } finally { setLoading(false); }
  }, [qs, tab]);
  useEffect(() => { load(); }, [load]);

  async function more() {
    if (!next) return;
    const page = await fetch("/api/admin/prediction-updates?" + qs({ cursor: next })).then((r) => r.json());
    if (tab === "reviewed") setReviewed((p) => [...p, ...(page.items ?? [])]); else setCards((p) => [...p, ...(page.cards ?? [])]);
    setNext(page.nextCursor ?? null);
  }
  async function moreFlags() {
    if (!flagNext) return;
    const f = await fetch("/api/admin/evidence-review?reviewed=unreviewed&timing=upcoming&days=30&pageSize=10&cursor=" + encodeURIComponent(flagNext)).then((r) => r.json());
    setFlags((p) => [...p, ...(f.items ?? [])]); setFlagNext(f.nextCursor ?? null);
  }
  async function retainFlag(id: string) {
    try { await post("/api/admin/evidence-review", { predictionId: id, action: "RETAIN", note: "Evidence checked from the Prediction updates workspace; retained." }); setMessage("Recorded: retained unchanged."); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  }

  const tabs = [
    { id: "new" as const, label: "New evidence", count: counts?.needingApproval },
    { id: "needs" as const, label: "Needs review", count: counts?.needsMoreEvidence },
    { id: "reviewed" as const, label: "Reviewed", count: undefined },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Prediction updates</h1>
        <p className="max-w-2xl text-sm text-gray-400">
          New football evidence on existing predictions. Review what changed, then approve an updated explanation or keep the original.
          Nothing reaches the public site without your explicit action, and selections, confidence and odds never change here.
        </p>
        {counts && counts.awaitingDecision > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-amber-300"><AlertTriangle size={15} aria-hidden />{counts.awaitingDecision} awaiting your decision</p>
        )}
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-brand-border" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
            className={`whitespace-nowrap px-2.5 py-2 text-sm sm:px-3 ${tab === t.id ? "border-b-2 border-white font-semibold text-white" : "text-gray-400 hover:text-white"}`}>
            {t.label}{t.count != null ? ` (${t.count})` : ""}
          </button>
        ))}
      </nav>

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-400">Advanced options</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs uppercase tracking-wide text-gray-400">Tier
            <select className={FIELD + " mt-1"} value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="all">All</option><option value="paid">VIP / Premium</option><option value="free">Free</option>
            </select></label>
          <label className="text-xs uppercase tracking-wide text-gray-400">Status
            <select className={FIELD + " mt-1"} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="PUBLISHED">Published</option><option value="PENDING_REVIEW">Pending review</option><option value="DRAFT">Held draft</option>
            </select></label>
          <label className="text-xs uppercase tracking-wide text-gray-400">Kickoff from
            <input type="date" className={FIELD + " mt-1"} value={kickoffFrom} onChange={(e) => setKickoffFrom(e.target.value)} /></label>
          <label className="text-xs uppercase tracking-wide text-gray-400">Kickoff to
            <input type="date" className={FIELD + " mt-1"} value={kickoffTo} onChange={(e) => setKickoffTo(e.target.value)} /></label>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Detailed tools: <Link className="underline" href="/admin/evidence-review">Evidence review (historical data quality)</Link> · <Link className="underline" href="/admin/reassessment">Reassessment</Link>
        </p>
      </details>

      {message && <p className="text-sm text-gray-200" role="status">{message}</p>}

      {tab !== "reviewed" && (
        <section className="space-y-3">
          {tab === "needs" && <h2 className="text-sm font-semibold text-gray-300">Needs more evidence</h2>}
          <p className="text-xs text-gray-500">{total} {tab === "new" ? "open case" : "case"}{total === 1 ? "" : "s"} · upcoming first, VIP / Premium first, then unpublished, then free.</p>
          <ul className="space-y-4">
            {cards.map((c) => <UpdateCardView key={c.id} card={c} onReview={() => setOpen(c)} onDone={(m) => { setMessage(m); load(); }} />)}
          </ul>
          {!loading && cards.length === 0 && <p className="text-sm text-gray-400">{tab === "new" ? "No new evidence waiting." : "Nothing waiting for more evidence."}</p>}
          {next && <button className="btn btn-ghost w-full sm:w-auto" onClick={more}>Load more</button>}
        </section>
      )}

      {tab === "needs" && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">Evidence needs checking (upcoming, generated in the last 30 days)</h2>
          <p className="text-xs text-gray-500">A data-quality note about the evidence a pick was written from, not new evidence. &ldquo;Evidence available&rdquo; means coverage, not a check of every statement.</p>
          <ul className="space-y-4">
            {flags.map((f) => (
              <li key={f.id} className="card space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/admin/predictions/${f.id}`} className="text-base font-semibold hover:underline">{f.fixture}</Link>
                  <p className="flex items-center gap-1.5 text-sm text-gray-200"><HelpCircle size={15} aria-hidden />{f.label}</p>
                </div>
                <p className="text-xs text-gray-400">{when(f.kickoff)} · {f.paid ? "VIP / Premium" : "Free"} · {f.market}: {f.pick} · {f.confidence}%</p>
                {f.warning && <p className="text-sm text-gray-300">{f.warning}</p>}
                <ul className="list-disc pl-5 text-sm text-gray-400">{f.evidence.reasons.slice(0, 3).map((r) => <li key={r.code}>{r.detail}</li>)}</ul>
                <button className="btn btn-ghost w-full sm:w-auto" onClick={() => retainFlag(f.id)}>Checked: keep unchanged</button>
              </li>
            ))}
          </ul>
          {flags.length === 0 && !loading && <p className="text-sm text-gray-400">No unreviewed evidence-quality notes for upcoming picks.</p>}
          {flagNext && <button className="btn btn-ghost w-full sm:w-auto" onClick={moreFlags}>Load more</button>}
        </section>
      )}

      {tab === "reviewed" && (
        <section className="space-y-3">
          <ul className="divide-y divide-brand-border">
            {reviewed.map((r) => (
              <li key={r.revisionId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/predictions/${r.predictionId}`} className="font-semibold hover:underline">{r.fixture}</Link>
                  <p className="text-xs text-gray-400">{r.pick} · {r.confidence}% · kickoff {when(r.kickoff)}</p>
                  <p className="text-sm text-gray-300">{r.reason}</p>
                </div>
                <p className="shrink-0 text-xs text-gray-400">{KIND_LABEL[r.kind] ?? r.kind} · {when(r.at)}</p>
              </li>
            ))}
          </ul>
          {reviewed.length === 0 && !loading && <p className="text-sm text-gray-400">No decisions recorded yet.</p>}
          {next && <button className="btn btn-ghost w-full sm:w-auto" onClick={more}>Load more</button>}
        </section>
      )}

      {open && <ReviewModal card={open} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setMessage(m); load(); }} />}
    </div>
  );
}
