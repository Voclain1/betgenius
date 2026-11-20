"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedDay } from "@/lib/feedDays";

type DayItem = {
  day: FeedDay;
  href: string;
  eyebrow: string;
  date: string;
  fullDate: string;
};

/**
 * A compact touch-first date rail, shared across all prediction surfaces.
 * Links remain normal, bookmarkable server navigation — no new data fetching.
 * The selected date is scrolled into view after hydration (not the whole page).
 */
export function FeedDayScroller({ items, active }: { items: DayItem[]; active: FeedDay }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const remaining = Math.max(0, track.scrollWidth - track.clientWidth);
    const left = track.scrollLeft > 3;
    const right = track.scrollLeft < remaining - 3;
    setEdges(previous => previous.left === left && previous.right === right
      ? previous : { left, right });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    // The initial selection must jump into view immediately; CSS scroll-smooth
    // would leave it clipped on narrow phones during hydration. Button clicks
    // use explicit smooth behavior below, so user-initiated movement stays fluid.
    // scrollLeft changes only the date rail; scrollIntoView would also move
    // the entire document vertically when this control sits below the fold.
    const selected = Array.from(track.querySelectorAll<HTMLAnchorElement>("a[data-feed-day]"))
      .find(link => link.dataset.feedDay === active);
    if (selected) {
      const left = selected.offsetLeft - track.offsetLeft
        - (track.clientWidth - selected.offsetWidth) / 2;
      track.scrollLeft = Math.max(0, left);
    }
    updateEdges();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateEdges) : null;
    observer?.observe(track);
    window.addEventListener("resize", updateEdges);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateEdges);
    };
  }, [active, updateEdges]);

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({
      left: direction * Math.max(180, track.clientWidth * 0.7),
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <div data-testid="feed-day-strip" className="w-full min-w-0 max-w-full">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          aria-label="Scroll dates left"
          onClick={() => move(-1)}
          disabled={!edges.left}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-border bg-brand-card text-gray-200 transition hover:border-brand/50 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-25 sm:inline-flex"
        >
          <ChevronLeft size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>

        <nav aria-label="Select day" className="relative min-w-0 flex-1">
          <div
            ref={trackRef}
            data-testid="feed-day-track"
            onScroll={updateEdges}
            className="feed-day-track flex min-w-0 max-w-full snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain rounded-2xl border border-brand-border bg-brand-card p-1.5 sm:gap-2 sm:p-2"
          >
            {items.map(item => {
              const current = item.day === active;
              return (
                <Link
                  key={item.day}
                  data-feed-day={item.day}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  aria-label={`Predictions for ${item.fullDate}${current ? ", selected" : ""}`}
                  title={item.fullDate}
                  className={`relative flex h-[62px] w-[86px] shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-xl border px-1.5 text-center leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-[66px] sm:w-[96px] ${
                    current
                      ? "border-brand bg-brand text-on-brand shadow-sm"
                      : "border-transparent bg-gray-500/10 text-gray-100 hover:border-brand/40 hover:bg-brand/10"
                  }`}
                >
                  <span className={`max-w-full truncate text-[10px] font-bold uppercase tracking-[0.06em] ${current ? "opacity-85" : "text-gray-400"}`}>
                    {item.eyebrow}
                  </span>
                  <span className="whitespace-nowrap text-[15px] font-extrabold tabular-nums tracking-tight">
                    {item.date}
                  </span>
                </Link>
              );
            })}
          </div>
          <span aria-hidden="true" className={`pointer-events-none absolute inset-y-1 left-0 w-6 rounded-l-2xl bg-gradient-to-r from-brand-card to-transparent transition-opacity ${edges.left ? "opacity-100" : "opacity-0"}`} />
          <span aria-hidden="true" className={`pointer-events-none absolute inset-y-1 right-0 w-6 rounded-r-2xl bg-gradient-to-l from-brand-card to-transparent transition-opacity ${edges.right ? "opacity-100" : "opacity-0"}`} />
        </nav>

        <button
          type="button"
          aria-label="Scroll dates right"
          onClick={() => move(1)}
          disabled={!edges.right}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-border bg-brand-card text-gray-200 transition hover:border-brand/50 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-25 sm:inline-flex"
        >
          <ChevronRight size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-[10px] font-medium text-gray-500 sm:hidden">
        <span>West Africa Time</span>
        <span>Swipe to browse dates <span aria-hidden="true">→</span></span>
      </div>
    </div>
  );
}
