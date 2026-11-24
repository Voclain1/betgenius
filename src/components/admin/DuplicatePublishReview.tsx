"use client";
import { useState } from "react";
import type { DuplicateReview, SelectionSummary } from "@/lib/duplicatePublication";

const MIN_REASON = 8;
const RELATION_LABEL: Record<DuplicateReview["relation"], string> = {
  SAME_SELECTION: "Same selection",
  CONFLICTING_SELECTION: "Conflicting selection",
  DISTINCT_MARKET: "Different market",
};

export type DuplicateChoice = { publish: boolean; reason: string };

function Selection({ title, s }: { title: string; s: SelectionSummary }) {
  return (
    <div className="space-y-1 rounded-xl border border-brand-border bg-brand-bg p-3 text-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{title}</p>
      <p className="font-semibold text-gray-100">{s.market}: {s.pick}</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs text-gray-400">
        <dt>Category</dt><dd>{s.categories.join(", ") || "None"}</dd>
        <dt>Confidence</dt><dd>{s.confidence}%</dd>
        <dt>Odds</dt><dd>{s.odds != null ? s.odds.toFixed(2) : "Not recorded"}</dd>
      </dl>
    </div>
  );
}

/**
 * Pre-publication side-by-side review. Raw database ids never appear; each
 * match is decided on its own, and the default for every match is to skip.
 */
export function DuplicatePublishReview({ reviews, unaffected, busy, onConfirm, onCancel }: {
  reviews: DuplicateReview[]; unaffected: number; busy: boolean;
  onConfirm: (choices: Record<string, DuplicateChoice>) => void; onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, DuplicateChoice>>({});
  const set = (id: string, patch: Partial<DuplicateChoice>) => setChoices((c) => ({ ...c, [id]: { ...(c[id] ?? { publish: false, reason: "" }), ...patch } }));
  const invalid = reviews.some((r) => choices[r.predictionId]?.publish && (choices[r.predictionId]?.reason.trim().length ?? 0) < MIN_REASON);
  const additional = reviews.filter((r) => choices[r.predictionId]?.publish).length;

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="dup-review-title" className="card space-y-5">
      <header className="space-y-1">
        <h2 id="dup-review-title" className="text-lg font-bold text-white">Review before publishing</h2>
        <p className="text-sm text-gray-400">
          {reviews.length} {reviews.length === 1 ? "match already shows" : "matches already show"} a published selection. Nothing has been published for
          {reviews.length === 1 ? " it" : " them"} yet. Skipped selections stay in the review queue.
        </p>
      </header>

      <ul className="space-y-5">
        {reviews.map((r) => {
          const choice = choices[r.predictionId] ?? { publish: false, reason: "" };
          const title = `${r.match.homeTeam ?? "Home"} vs ${r.match.awayTeam ?? "Away"}`;
          return (
            <li key={r.predictionId} className="space-y-3 border-t border-brand-border pt-4 first:border-t-0 first:pt-0">
              <div>
                <h3 className="font-semibold text-gray-100">{title}</h3>
                <p className="text-xs text-gray-500">
                  {[r.match.league, r.match.kickoff ? new Date(r.match.kickoff).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {r.existing.map((e, i) => <Selection key={i} title="Already published" s={e} />)}
                <Selection title="Proposed" s={r.proposed} />
              </div>
              <p className="text-sm text-gray-300"><span className="font-semibold">{RELATION_LABEL[r.relation]}.</span> {r.explanation}</p>
              <fieldset className="space-y-2" aria-label={`Decision for ${title}`}>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="radio" name={`d-${r.predictionId}`} checked={!choice.publish} onChange={() => set(r.predictionId, { publish: false })} />
                  Skip this selection
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="radio" name={`d-${r.predictionId}`} checked={choice.publish} onChange={() => set(r.predictionId, { publish: true })} />
                  Publish it as an additional selection
                </label>
                {choice.publish && (
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400" htmlFor={`reason-${r.predictionId}`}>Reason (recorded with this decision, at least {MIN_REASON} characters)</label>
                    <input id={`reason-${r.predictionId}`} className="input w-full" value={choice.reason} maxLength={500}
                      onChange={(e) => set(r.predictionId, { reason: e.target.value })} />
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy || invalid} className="btn btn-primary text-xs" onClick={() => onConfirm(choices)}>
          Publish {unaffected + additional} and skip {reviews.length - additional}
        </button>
        <button disabled={busy} className="btn btn-ghost text-xs" onClick={onCancel}>Cancel, publish nothing</button>
        {unaffected > 0 && <span className="text-xs text-gray-500">{unaffected} other {unaffected === 1 ? "selection has" : "selections have"} no clash.</span>}
      </div>
    </section>
  );
}
