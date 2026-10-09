"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Eye, EyeOff, History } from "lucide-react";
import { readHidePast, writeHidePast } from "@/lib/predictionTimeline";

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function MoreButton({ shown, total, pageSize, onClick }: { shown: number; total: number; pageSize: number; onClick: () => void }) {
  const left = total - shown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-sm font-bold text-gray-100 transition hover:border-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      Show {Math.min(pageSize, left)} more{" "}
      <span className="font-medium text-gray-500">· {left} left</span>
      <ChevronDown size={16} aria-hidden />
    </button>
  );
}

/**
 * A long prediction list in two groups: upcoming picks, then a band that
 * separates (and can hide) the picks on matches already played. Each group
 * opens on its first page and grows a page at a time.
 *
 * The pages arrive already rendered by the server (CategoryPredictionsList
 * output), so no row data or gating moves to the browser; this only decides
 * how many are mounted. Played matches are shown by default, which is also
 * what the server renders; a stored "hide" is applied after mount.
 */
export function PredictionTimeline({
  upcoming,
  past,
  upcomingCount,
  pastCount,
  pageSize,
  emptyUpcoming,
}: {
  upcoming: React.ReactNode[];
  past: React.ReactNode[];
  upcomingCount: number;
  pastCount: number;
  pageSize: number;
  emptyUpcoming: string;
}) {
  const [upPages, setUpPages] = useState(1);
  const [pastPages, setPastPages] = useState(1);
  const [hidePast, setHidePast] = useState(false);

  useEffect(() => {
    setHidePast(readHidePast(localStore()));
  }, []);

  const toggle = () => {
    setHidePast(!hidePast);
    writeHidePast(localStore(), !hidePast);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-black uppercase tracking-[0.14em] text-gray-400">
        Upcoming <span className="tabular-nums text-gray-500">· {upcomingCount}</span>
      </h3>
      {upcomingCount === 0 ? (
        <div className="card text-sm text-gray-400">{emptyUpcoming}</div>
      ) : (
        <>
          {upcoming.slice(0, upPages).map((page, i) => (
            <Fragment key={i}>{page}</Fragment>
          ))}
          {upPages < upcoming.length && (
            <MoreButton shown={Math.min(upPages * pageSize, upcomingCount)} total={upcomingCount} pageSize={pageSize} onClick={() => setUpPages(upPages + 1)} />
          )}
        </>
      )}

      {pastCount > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-border bg-brand-card px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <History size={20} aria-hidden className="shrink-0 text-gray-400" />
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-100">Played matches</div>
                <div className="text-xs text-gray-500">
                  {pastCount} {pastCount === 1 ? "prediction" : "predictions"} on matches already played
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!hidePast}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-brand-bg transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {hidePast ? <Eye size={14} strokeWidth={2.75} aria-hidden /> : <EyeOff size={14} strokeWidth={2.75} aria-hidden />}
              {hidePast ? "Show past" : "Hide past"}
            </button>
          </div>
          {!hidePast && (
            <>
              {past.slice(0, pastPages).map((page, i) => (
                <Fragment key={i}>{page}</Fragment>
              ))}
              {pastPages < past.length && (
                <MoreButton shown={Math.min(pastPages * pageSize, pastCount)} total={pastCount} pageSize={pageSize} onClick={() => setPastPages(pastPages + 1)} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
