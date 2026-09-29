"use client";

import { useEffect, useState } from "react";
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

/** Reads window.localStorage without letting a blocked accessor throw. */
function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The Detailed / Compact control for a non-TODAY category feed, and the only
 * client state that feature needs.
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
  tabs: React.ReactNode;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs}
        <div
          role="group"
          aria-label="Prediction view"
          className="inline-flex rounded-lg border border-brand-border bg-brand-card p-1"
        >
          {PREDICTION_VIEWS.map((option) => {
            const isActive = option === view;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isActive}
                onClick={() => choose(option)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"
                }`}
              >
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
