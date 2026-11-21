"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import {
  DEFAULT_PREDICTION_VIEW,
  PREDICTION_VIEWS,
  readPredictionView,
  writePredictionView,
  type PredictionView,
} from "@/lib/predictionView";
import { trackEngagement } from "@/lib/engagement";

const LABELS: Record<PredictionView, string> = {
  detailed: "Detailed",
  compact: "Compact",
};

const ICONS: Record<PredictionView, typeof List> = {
  detailed: LayoutGrid,
  compact: List,
};

/** Reads window.localStorage without letting a blocked accessor throw. */
function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The Detailed / Compact control for every public prediction list (category
 * feeds except TODAY, team, league and cup pages, the market guides), and the
 * only client state that feature needs. One stored preference drives them all.
 *
 * Owns the preference and nothing else. Both renderings arrive already built
 * by the server page — `detailed` and `compact` are CategoryPredictionsList
 * output — so no row data, gating or query moves to the browser, and the
 * locked rows a viewer receives are the same rows whichever view shows them.
 *
 * Only the active view is mounted. The inactive one is never in the DOM, so
 * its in-feed ad frames do not load behind the visible ones.
 *
 * HYDRATION: the first render uses Compact on server and client, avoiding a
 * mismatch. A previously saved Detailed preference is applied after mount.
 * Both views are server-rendered as props, preserving existing access rules.
 *
 * `tabs` and `intro` are passed through so the control can sit in the same
 * row as the day tabs while the list stays below any intro copy — the page's
 * existing order, with one control added to it.
 */
export function PredictionViewSwitch({
  tabs,
  intro,
  detailed,
  compact,
}: {
  /** Day tabs, a section heading, or nothing: whatever sits left of the switch. */
  tabs?: React.ReactNode;
  intro?: React.ReactNode;
  detailed: React.ReactNode;
  compact: React.ReactNode;
}) {
  const [view, setView] = useState<PredictionView>(DEFAULT_PREDICTION_VIEW);

  useEffect(() => {
    setView(readPredictionView(localStore()));
  }, []);

  const choose = (next: PredictionView) => {
    if (next !== view) trackEngagement("prediction_view_change", { view: next });
    setView(next);
    writePredictionView(localStore(), next);
  };

  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 ${tabs ? "justify-between" : "justify-end"}`}>
        {tabs && <div className="w-full min-w-0 lg:w-auto lg:flex-1">{tabs}</div>}
        {/* Deliberately unlike the day tabs beside it: round, small, icon-led,
            and an inverted (light-on-dark / dark-on-light) active state rather
            than brand green, so the two controls never read as one. */}
        <div role="group" aria-label="Prediction view" className="inline-flex shrink-0 items-center gap-1 rounded-2xl border border-brand-border bg-brand-card p-1 shadow-sm">
          {PREDICTION_VIEWS.map((option) => {
            const isActive = option === view;
            const Icon = ICONS[option];
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isActive}
                onClick={() => choose(option)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 py-1 text-[11px] font-bold tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive ? "bg-brand text-on-brand shadow-sm" : "text-gray-400 hover:bg-brand/5 hover:text-gray-100"
                }`}
              >
                <Icon size={13} strokeWidth={2.75} aria-hidden />
                {LABELS[option]}
              </button>
            );
          })}
        </div>
      </div>
      {intro}
      {view === "compact" ? compact : detailed}
    </>
  );
}
