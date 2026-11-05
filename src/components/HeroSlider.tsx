"use client";
import { kickoffLabel } from "@/lib/footballTime";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { ScoreCell } from "@/components/LiveScores";
import { matchSlug } from "@/lib/slug";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { textTone } from "@/lib/tone";
import type { HeroSlideData } from "@/lib/heroSlides";

/**
 * The hero's top picks of the day, one per slide (selection: lib/heroSlides).
 *
 * A native scroll-snap track, so swiping works with no gesture code and the
 * slides are ordinary links. It advances on its own every AUTOPLAY_MS, and
 * stops for good once the reader touches it (swipe, dot, hover or focus), or
 * when they prefer reduced motion. Every slide is in the markup, so the server
 * render and search engines see all the picks, not just the first.
 */
const AUTOPLAY_MS = 6000;

export function HeroSlider({ slides }: { slides: HeroSlideData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const el = track.current;
      if (!el) return;
      const next =
        (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      goTo(next);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [paused, slides.length, goTo]);

  const stop = () => setPaused(true);

  return (
    // min-w-0: as a grid item the track would otherwise size to all its slides side by side.
    <div
      className="hero-picks relative w-full min-w-0"
      aria-roledescription="carousel"
      aria-label="Top picks today"
      onPointerEnter={stop}
      onTouchStart={stop}
      onFocusCapture={stop}
    >
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[28px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <Slide key={s.id} slide={s} index={i} total={slides.length} />
        ))}
      </div>

      {slides.length > 1 && (
        <div className="spotlight-pagination">
          <div className="spotlight-pagination-inner">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Show pick ${i + 1} of ${slides.length}`}
                aria-current={i === active}
                onClick={() => {
                  stop();
                  goTo(i);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full"
              >
                <span
                  aria-hidden
                  className={`h-1.5 rounded-full transition-all ${i === active ? "w-4 bg-brand" : "w-1.5 bg-gray-500"}`}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Slide({
  slide: s,
  index,
  total,
}: {
  slide: HeroSlideData;
  index: number;
  total: number;
}) {
  const slug = matchSlug(s);
  const settled = !!s.outcome && s.outcome !== "PENDING";
  const kickoff = s.kickoff ? new Date(s.kickoff) : null;

  const body = (
    <div className="hero-pick spotlight-match">
      <div aria-hidden className="spotlight-pitch">
        <div />
        <span />
      </div>
      <div className="spotlight-topline">
        <LeagueBadge leagueApiId={s.leagueApiId} leagueName={s.leagueName} />
        <span className="spotlight-index">
          {String(index + 1).padStart(2, "0")}{" "}
          <span>/ {String(total).padStart(2, "0")}</span>
        </span>
      </div>
      <div className="spotlight-matchup">
        <div className="spotlight-team">
          <div className="spotlight-crest">
            <TeamCrest
              teamApiId={s.homeTeamApiId}
              name={s.homeTeam}
              size={66}
            />
          </div>
          <span>{s.homeTeam}</span>
        </div>
        <div className="spotlight-versus">
          <span>VS</span>
          <time suppressHydrationWarning>
            {kickoff ? kickoffLabel(kickoff) : ""}
          </time>
        </div>
        <div className="spotlight-team">
          <div className="spotlight-crest">
            <TeamCrest
              teamApiId={s.awayTeamApiId}
              name={s.awayTeam}
              size={66}
            />
          </div>
          <span>{s.awayTeam}</span>
        </div>
      </div>
      <div className="spotlight-verdict">
        <div>
          <div className="spotlight-market">{s.market}</div>
          <div className="spotlight-pick">{s.pick}</div>
        </div>
        <div className="spotlight-confidence">
          {settled ? (
            <>
              <strong>
                {s.finalHomeScore ?? "–"}–{s.finalAwayScore ?? "–"}
              </strong>
              <span
                className={textTone(
                  OUTCOME_STYLES[s.outcome!] ?? "text-gray-400",
                )}
              >
                {s.outcome}
              </span>
            </>
          ) : (
            <>
              <strong>
                {s.confidence}
                <small>%</small>
              </strong>
              <span>Confidence</span>
              <ScoreCell
                homeTeamApiId={s.homeTeamApiId}
                awayTeamApiId={s.awayTeamApiId}
                kickoff={s.kickoff}
                align="right"
                hideWhenEmpty
              />
            </>
          )}
        </div>
      </div>
      <div className="spotlight-open">
        <span>Read the full prediction</span>
        <span aria-hidden>↗</span>
      </div>
    </div>
  );

  return (
    <div
      className="w-full shrink-0 snap-center"
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
    >
      {slug ? (
        <Link
          href={`/predictions/match/${slug}`}
          className="block h-full transition hover:brightness-110"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
