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
 * HYDRATION: the first render always uses the default, on the server and in
 * the browser alike, so the markup matches. The stored preference is applied
 * after mount. That is also why the server HTML crawlers see is the Detailed
 * feed, reasoning included, whatever a given reader prefers.
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
    setView(next);
    writePredictionView(localStore(), next);
  };

  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 ${tabs ? "justify-between" : "justify-end"}`}>
        {tabs}
        {/* Deliberately unlike the day tabs beside it: round, small, icon-led,
            and an inverted (light-on-dark / dark-on-light) active state rather
            than brand green, so the two controls never read as one. */}
        <div role="group" aria-label="Prediction view" className="inline-flex shrink-0 items-center gap-0.5 rounded-full border-2 border-gray-500 p-0.5">
          {PREDICTION_VIEWS.map((option) => {
            const isActive = option === view;
            const Icon = ICONS[option];
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isActive}
                onClick={() => choose(option)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive ? "bg-gray-100 text-brand-bg" : "text-gray-400 hover:text-gray-100"
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
